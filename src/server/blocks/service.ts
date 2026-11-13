import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { assetTag, isVoiceRef, replaceAssetTag, type SectionedBlock } from "@/server/damis";
import { getDb, type DbExecutor, type DbTx } from "@/server/db/client";
import { project, projectEvent, promptBlock, scriptVersion } from "@/server/db/schema";
import { enqueue, scriptDetectAssets } from "@/server/jobs";
import { decodeOrderCursor, encodeOrderCursor } from "@/server/projects/cursor";

export type PromptBlock = typeof promptBlock.$inferSelect;

export const SECTIONING_STATES = ["idle", "running", "done", "failed", "stale"] as const;
export type SectioningState = (typeof SECTIONING_STATES)[number];

/** What `project.stageState.sectioning` holds (written by the script services and handlers). */
export type SectioningRecord = {
  state: "running" | "done" | "failed";
  scriptVersionId: string;
  failure: string | null;
  /** Done: how many shots this version sent back through Production's preparation. */
  resetBlocks?: number;
};

export type SectioningStatus = {
  state: SectioningState;
  blockCount: number;
  failure: string | null;
  /** Shots the last script edit sent back through Production's preparation (0 when none). */
  resetBlocks: number;
};

export type ReplaceBlocksResult = {
  created: number;
  carried: number;
  superseded: number;
  reset: number;
  /** Set when nothing changed because the version is not the newest accepted one any more. */
  skipped?: "not_latest";
};

export const DEFAULT_BLOCK_PAGE_SIZE = 50;
export const MAX_BLOCK_PAGE_SIZE = 200;

/** Thrown for input the caller can fix; `message` is safe to show. */
export class BlocksInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlocksInputError";
  }
}

const uuid = z.uuid();

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BlocksInputError(result.error.issues[0]?.message ?? "That input is not valid.");
  }
  return result.data;
}

const sectionedBlockSchema = z.object({
  title: z.string(),
  scriptExcerpt: z.string().min(1),
  prompt: z.string().min(1),
  durationSeconds: z.number().int().positive(),
  assetRefs: z.array(z.string()),
  orderIndex: z.number().int().min(0),
  /** The dami run that produced this block, when known (one run per segment). */
  damiRunId: uuid.optional(),
});

const replaceBlocksSchema = z.object({
  projectId: uuid,
  scriptVersionId: uuid,
  blocks: z
    .array(sectionedBlockSchema)
    .min(1, "Sectioning returned no blocks.")
    // The order is the film's: two blocks in one place would also share a clip's file name.
    .refine((blocks) => new Set(blocks.map((b) => b.orderIndex)).size === blocks.length, {
      message: "Sectioning returned two blocks in the same place.",
    }),
  damiRunIds: z.array(uuid),
});

const listBlocksSchema = z.object({
  limit: z.number().int().min(1).max(MAX_BLOCK_PAGE_SIZE).default(DEFAULT_BLOCK_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
});

const current = isNull(promptBlock.supersededAt);

/** Whitespace-normalised excerpt: the key that carries a block's lineage across script versions. */
export function normalizeExcerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sameAssets(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((ref, i) => ref === b[i]);
}

/** How close two excerpts are (Dice coefficient over their words, 0 to 1). */
export function excerptSimilarity(a: string, b: string): number {
  const words = (text: string) =>
    normalizeExcerpt(text)
      .toLowerCase()
      .match(/[\p{L}\p{N}']+/gu) ?? [];
  const left = words(a);
  const right = words(b);
  if (left.length === 0 || right.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const word of left) counts.set(word, (counts.get(word) ?? 0) + 1);
  let common = 0;
  for (const word of right) {
    const n = counts.get(word) ?? 0;
    if (n > 0) {
      common++;
      counts.set(word, n - 1);
    }
  }
  return (2 * common) / (left.length + right.length);
}

/** An edited shot (same place in the story, mostly the same words) continues its lineage. */
const EDITED_SIMILARITY = 0.6;
/** How far (in story positions) an edited shot may have moved. */
const EDITED_WINDOW = 3;

/**
 * The previous block each new block continues: first an identical excerpt (whitespace-
 * normalised), then, among the blocks left, an edited version of the same shot (a similar excerpt
 * near the same position). Unmatched new blocks start a new lineage.
 */
function matchPrevious(
  previous: PromptBlock[],
  blocks: readonly { scriptExcerpt: string; orderIndex: number }[],
): (PromptBlock | null)[] {
  const byExcerpt = new Map<string, PromptBlock[]>();
  for (const row of previous) {
    const key = normalizeExcerpt(row.scriptExcerpt);
    byExcerpt.set(key, [...(byExcerpt.get(key) ?? []), row]);
  }
  const matches = blocks.map(
    (block) => byExcerpt.get(normalizeExcerpt(block.scriptExcerpt))?.shift() ?? null,
  );
  const taken = new Set(matches.flatMap((m) => (m ? [m.id] : [])));
  const left = previous.filter((row) => !taken.has(row.id));
  blocks.forEach((block, i) => {
    if (matches[i]) return;
    let best: { row: PromptBlock; score: number; distance: number } | null = null;
    for (const row of left) {
      if (taken.has(row.id)) continue;
      const distance = Math.abs(row.orderIndex - block.orderIndex);
      if (distance > EDITED_WINDOW) continue;
      const score = excerptSimilarity(row.scriptExcerpt, block.scriptExcerpt);
      if (score < EDITED_SIMILARITY) continue;
      if (!best || score > best.score || (score === best.score && distance < best.distance)) {
        best = { row, score, distance };
      }
    }
    if (best) {
      matches[i] = best.row;
      taken.add(best.row.id);
    }
  });
  return matches;
}

/** The event `rewriteAssetRefs` logs: a ref renamed or merged into another, from then on. */
export const REF_REWRITTEN_EVENT = "asset.ref_rewritten";

/** Applies the ref rewrites logged after `since` (oldest first) to a list of refs. */
function applyRewrites(
  refs: readonly string[],
  since: Date,
  rewrites: readonly { from: string; to: string; at: Date }[],
): string[] {
  let out = [...refs];
  for (const r of rewrites) {
    if (r.at <= since) continue;
    out = [...new Set(out.map((ref) => (ref === r.from ? r.to : ref)))];
  }
  return out;
}

/**
 * The asset refs sectioning gave each lineage for the script version its current row was cut from
 * (its first version of that script version, which holds sectioning's refs). A later version may
 * hold the user's own choice (`setBlockAssets`), which is not a change of the script. Renames and
 * merges logged since then are applied, so a renamed asset does not look like a user's choice.
 */
async function sectionedAssetRefs(
  tx: DbTx,
  projectId: string,
  rows: readonly PromptBlock[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  // Grouped by script version (normally one): one query each, on the (lineage, version) index.
  const byVersion = new Map<string, string[]>();
  for (const row of rows) {
    if (row.versionNumber === 1) continue;
    byVersion.set(row.scriptVersionId, [
      ...(byVersion.get(row.scriptVersionId) ?? []),
      row.lineageId,
    ]);
  }
  if (byVersion.size === 0) return map;
  const rewrites = (
    await tx
      .select({ payload: projectEvent.payload, at: projectEvent.createdAt })
      .from(projectEvent)
      .where(and(eq(projectEvent.projectId, projectId), eq(projectEvent.type, REF_REWRITTEN_EVENT)))
      .orderBy(asc(projectEvent.createdAt))
  ).flatMap((e) => {
    const from = e.payload?.from;
    const to = e.payload?.to;
    return typeof from === "string" && typeof to === "string" ? [{ from, to, at: e.at }] : [];
  });
  for (const [versionId, lineageIds] of byVersion) {
    const origins = await tx
      .selectDistinctOn([promptBlock.lineageId], {
        lineageId: promptBlock.lineageId,
        assetRefs: promptBlock.assetRefs,
        createdAt: promptBlock.createdAt,
      })
      .from(promptBlock)
      .where(
        and(inArray(promptBlock.lineageId, lineageIds), eq(promptBlock.scriptVersionId, versionId)),
      )
      .orderBy(promptBlock.lineageId, asc(promptBlock.versionNumber));
    for (const origin of origins) {
      map.set(origin.lineageId, applyRewrites(origin.assetRefs, origin.createdAt, rewrites));
    }
  }
  return map;
}

/**
 * Replaces the project's current blocks with a new set, in one transaction. A current block whose
 * excerpt (whitespace-normalised) equals a new block's keeps its lineage, and so does an edited
 * shot (a similar excerpt near the same position): a new row with the next version number. A
 * block whose prompt and sectioned assets are unchanged is carried as it was: identical content,
 * the user's own choice of assets, and (when prepared) its production preparation and approval.
 * Other blocks start a new lineage. Every previous current row gets `supersededAt`. `reset` counts
 * the new blocks that must be prepared again while the previous ones had been in production.
 *
 * Only the project's newest accepted script version may replace its blocks: checked under the
 * project lock, so a slow run for an older version can never supersede blocks cut from a newer
 * one. Otherwise nothing changes and the result has `skipped: "not_latest"`.
 */
export async function replaceBlocks(input: {
  projectId: string;
  scriptVersionId: string;
  blocks: Array<SectionedBlock & { damiRunId?: string }>;
  damiRunIds: string[];
}): Promise<ReplaceBlocksResult> {
  const { projectId, scriptVersionId, blocks, damiRunIds } = parse(replaceBlocksSchema, input);
  return getDb().transaction(async (tx): Promise<ReplaceBlocksResult> => {
    // Serialise replacements per project.
    await tx
      .select({ id: project.id })
      .from(project)
      .where(eq(project.id, projectId))
      .for("update");
    const [newest] = await tx
      .select({ id: scriptVersion.id })
      .from(scriptVersion)
      .where(
        and(
          eq(scriptVersion.projectId, projectId),
          isNull(scriptVersion.episodeId),
          eq(scriptVersion.status, "accepted"),
        ),
      )
      .orderBy(desc(scriptVersion.versionNumber))
      .limit(1);
    if (newest?.id !== scriptVersionId) {
      return { created: 0, carried: 0, superseded: 0, reset: 0, skipped: "not_latest" };
    }
    const previous = await tx
      .select()
      .from(promptBlock)
      .where(and(eq(promptBlock.projectId, projectId), current))
      .orderBy(asc(promptBlock.orderIndex));

    const matches = matchPrevious(previous, blocks);
    const sectioned = await sectionedAssetRefs(
      tx,
      projectId,
      matches.flatMap((m) => (m ? [m] : [])),
    );
    const inProduction = previous.some((row) => row.productionState !== "none");

    const now = new Date();
    if (previous.length > 0) {
      await tx
        .update(promptBlock)
        .set({ supersededAt: now })
        .where(and(eq(promptBlock.projectId, projectId), current));
    }

    let carried = 0;
    let reset = 0;
    const rows = blocks.map((block, i) => {
      const match = matches[i] ?? null;
      const fields = {
        projectId,
        episodeId: null,
        scriptVersionId,
        orderIndex: block.orderIndex,
        title: block.title || null,
        scriptExcerpt: block.scriptExcerpt,
        damiRunId: block.damiRunId ?? damiRunIds[0] ?? null,
      };
      if (!match) {
        if (inProduction) reset++;
        return {
          ...fields,
          prompt: block.prompt,
          durationSeconds: block.durationSeconds,
          assetRefs: block.assetRefs,
        };
      }
      carried++;
      // What sectioning said about this shot last time; the current row may hold the user's own
      // choice of assets on top of it, which survives an unrelated script edit.
      const origin = sectioned.get(match.lineageId) ?? match.assetRefs;
      const userChoice = !sameAssets(origin, match.assetRefs);
      const unchanged =
        normalizeExcerpt(match.scriptExcerpt) === normalizeExcerpt(block.scriptExcerpt) &&
        match.prompt === block.prompt &&
        (sameAssets(match.assetRefs, block.assetRefs) || sameAssets(origin, block.assetRefs));
      // An identical block keeps its finished preparation (and its approval), so Production
      // keeps its takes; anything else is prepared again.
      const keepProduction = unchanged && match.productionState === "ready";
      if (!keepProduction && match.productionState !== "none") reset++;
      return {
        ...fields,
        lineageId: match.lineageId,
        versionNumber: match.versionNumber + 1,
        prompt: unchanged ? match.prompt : block.prompt,
        durationSeconds: unchanged ? match.durationSeconds : block.durationSeconds,
        // What sectioning said; a user's choice lives on in the production refs below, so the
        // next edit compares against sectioning again.
        assetRefs: block.assetRefs,
        // An identical carry keeps pointing at the run that wrote the prompt.
        damiRunId: unchanged ? match.damiRunId : fields.damiRunId,
        ...(keepProduction
          ? {
              productionState: match.productionState,
              productionPrompt: match.productionPrompt,
              productionAssetRefs: match.productionAssetRefs,
              productionNotes: match.productionNotes,
              productionDamiRunId: match.productionDamiRunId,
              approvedAt: match.approvedAt,
            }
          : unchanged && userChoice
            ? // Prepared again with the user's choice of references.
              { productionAssetRefs: match.assetRefs.filter((r) => !isVoiceRef(r)) }
            : {}),
      };
    });
    await tx.insert(promptBlock).values(rows);
    return { created: rows.length - carried, carried, superseded: previous.length, reset };
  });
}

/** Flags the project's current blocks as stale (the script changed under them). */
export async function markBlocksStale(input: {
  projectId: string;
  reason: string;
}): Promise<number> {
  const { projectId, reason } = parse(
    z.object({ projectId: uuid, reason: z.string().trim().min(1).max(500) }),
    input,
  );
  const updated = await getDb()
    .update(promptBlock)
    .set({ stale: true, staleReason: reason })
    .where(and(eq(promptBlock.projectId, projectId), current, eq(promptBlock.stale, false)))
    .returning({ id: promptBlock.id });
  return updated.length;
}

/**
 * Replaces the asset reference `from` with `to` (both `kind:Name`) in the project's current
 * blocks, append-only: each affected block gets a new version (same lineage, next version number)
 * and the old row is superseded. The rewrite covers `assetRefs`, the `[kind:Name]` tags in the
 * prompt, and the production preparation (`productionAssetRefs`, tags in `productionPrompt`), which
 * is carried with its approval: a rename or merge changes no content. A block that already lists
 * `to` keeps it once; when its prepared refs held both, the token numbering no longer fits and the
 * block is prepared again (as it is when its preparation was still running). Logs
 * `asset.ref_rewritten` so later script edits compare against the new refs. Pass `executor` to run
 * inside the caller's transaction (renames, merges). Returns the number of blocks rewritten.
 */
export async function rewriteAssetRefs(
  input: { projectId: string; from: string; to: string },
  executor?: DbTx,
): Promise<number> {
  const { projectId, from, to } = parse(
    z.object({
      projectId: uuid,
      from: z.string().min(3).max(300),
      to: z.string().min(3).max(300),
    }),
    input,
  );
  if (from === to) return 0;
  const run = async (tx: DbTx): Promise<number> => {
    const fromJson = JSON.stringify([from]);
    const affected = await tx
      .select()
      .from(promptBlock)
      .where(
        and(
          eq(promptBlock.projectId, projectId),
          current,
          or(
            sql`${promptBlock.assetRefs} @> ${fromJson}::jsonb`,
            sql`${promptBlock.productionAssetRefs} @> ${fromJson}::jsonb`,
            gt(sql`strpos(${promptBlock.prompt}, ${assetTag(from)})`, 0),
          ),
        ),
      )
      .for("update");
    const now = new Date();
    for (const block of affected) {
      await tx.update(promptBlock).set({ supersededAt: now }).where(eq(promptBlock.id, block.id));
      const swap = (refs: readonly string[]) => [
        ...new Set(refs.map((ref) => (ref === from ? to : ref))),
      ];
      const prepared = block.productionAssetRefs;
      const clash = prepared !== null && prepared.includes(from) && prepared.includes(to);
      const keepProduction = block.productionState !== "pending" && !clash;
      await tx.insert(promptBlock).values({
        lineageId: block.lineageId,
        versionNumber: block.versionNumber + 1,
        projectId: block.projectId,
        episodeId: block.episodeId,
        scriptVersionId: block.scriptVersionId,
        orderIndex: block.orderIndex,
        title: block.title,
        scriptExcerpt: block.scriptExcerpt,
        prompt: replaceAssetTag(block.prompt, from, to),
        durationSeconds: block.durationSeconds,
        assetRefs: swap(block.assetRefs),
        stale: block.stale,
        staleReason: block.staleReason,
        damiRunId: block.damiRunId,
        ...(keepProduction
          ? {
              productionState: block.productionState,
              productionPrompt:
                block.productionPrompt === null
                  ? null
                  : replaceAssetTag(block.productionPrompt, from, to),
              productionAssetRefs: prepared === null ? null : swap(prepared),
              productionNotes: block.productionNotes,
              productionDamiRunId: block.productionDamiRunId,
              productionFailure: block.productionFailure,
              approvedAt: block.approvedAt,
            }
          : {}),
      });
    }
    await tx.insert(projectEvent).values({
      projectId,
      type: REF_REWRITTEN_EVENT,
      payload: { from, to, blocks: affected.length },
    });
    return affected.length;
  };
  return executor ? run(executor) : getDb().transaction(run);
}

/** True when the project's current blocks were cut from this script version. */
export async function hasCurrentBlocksFor(
  projectId: string,
  scriptVersionId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: promptBlock.id })
    .from(promptBlock)
    .where(
      and(
        eq(promptBlock.projectId, projectId),
        current,
        eq(promptBlock.scriptVersionId, scriptVersionId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function ownedProject(projectId: string, userId: string) {
  if (!uuid.safeParse(projectId).success) return null;
  const [row] = await getDb()
    .select({ id: project.id, stageState: project.stageState })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .limit(1);
  return row ?? null;
}

function decodeCursor(cursor: string): { orderIndex: number; id: string } {
  const decoded = decodeOrderCursor(cursor);
  if (!decoded) throw new BlocksInputError("That page link is no longer valid. Reload the list.");
  return decoded;
}

/** The project's current blocks in story order, keyset-paginated. */
export async function listBlocks(
  projectId: string,
  userId: string,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<{ items: PromptBlock[]; nextCursor: string | null } | null> {
  const { limit, cursor } = parse(listBlocksSchema, opts);
  if (!(await ownedProject(projectId, userId))) return null;
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await getDb()
    .select()
    .from(promptBlock)
    .where(
      and(
        eq(promptBlock.projectId, projectId),
        current,
        after
          ? sql`(${promptBlock.orderIndex}, ${promptBlock.id}) > (${after.orderIndex}, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(promptBlock.orderIndex), asc(promptBlock.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeOrderCursor(last.orderIndex, last.id) : null,
  };
}

const sectioningRecordSchema = z.object({
  state: z.enum(["running", "done", "failed"]),
  scriptVersionId: z.string(),
  failure: z.string().nullable(),
  resetBlocks: z.number().int().min(0).optional(),
});

export function readSectioningRecord(stageState: Record<string, unknown>): SectioningRecord | null {
  const parsed = sectioningRecordSchema.safeParse(stageState.sectioning);
  return parsed.success ? parsed.data : null;
}

/** Where sectioning stands for the project (idle before the first accepted script). */
export async function getSectioningStatus(
  projectId: string,
  userId: string,
): Promise<SectioningStatus | null> {
  const owned = await ownedProject(projectId, userId);
  if (!owned) return null;
  const record = readSectioningRecord(owned.stageState);
  const [counts] = await getDb()
    .select({
      total: count(),
      stale: sql<number>`count(*) filter (where ${promptBlock.stale})`.mapWith(Number),
    })
    .from(promptBlock)
    .where(and(eq(promptBlock.projectId, projectId), current));
  const blockCount = counts?.total ?? 0;
  const anyStale = (counts?.stale ?? 0) > 0;
  const resetBlocks = record?.state === "done" ? (record.resetBlocks ?? 0) : 0;
  if (record?.state === "running")
    return { state: "running", blockCount, failure: null, resetBlocks };
  if (record?.state === "failed")
    return { state: "failed", blockCount, failure: record.failure, resetBlocks };
  if (anyStale) return { state: "stale", blockCount, failure: null, resetBlocks };
  if (record?.state === "done" || blockCount > 0)
    return { state: "done", blockCount, failure: null, resetBlocks };
  return { state: "idle", blockCount, failure: null, resetBlocks };
}

/**
 * Writes `project.stageState.sectioning`. With `onlyFor`, writes only while the record still
 * belongs to that script version (a handler for an older version never overwrites a newer state).
 * Returns whether it was written.
 */
export async function setSectioningState(
  input: SectioningRecord & { projectId: string; onlyFor?: string },
  executor: DbExecutor = getDb(),
): Promise<boolean> {
  const record: SectioningRecord = {
    state: input.state,
    scriptVersionId: input.scriptVersionId,
    failure: input.failure,
    ...(input.resetBlocks !== undefined ? { resetBlocks: input.resetBlocks } : {}),
  };
  const updated = await executor
    .update(project)
    .set({
      stageState: sql`jsonb_set(${project.stageState}, '{sectioning}', ${JSON.stringify(record)}::jsonb, true)`,
    })
    .where(
      and(
        eq(project.id, input.projectId),
        input.onlyFor
          ? sql`${project.stageState}->'sectioning'->>'scriptVersionId' = ${input.onlyFor}`
          : undefined,
      ),
    )
    .returning({ id: project.id });
  return updated.length > 0;
}

/**
 * Runs asset detection and sectioning again after a failed run: only while the project's
 * sectioning state is `failed`. Sets it to `running` for the accepted script version and enqueues
 * `script.detect-assets` (which queues sectioning in turn) in the same transaction. Returns the
 * new status, or null when the project is missing, archived or not the user's.
 */
export async function retrySectioning(input: {
  projectId: string;
  userId: string;
}): Promise<SectioningStatus | null> {
  const { projectId, userId } = parse(
    z.object({ projectId: z.string(), userId: z.string().min(1) }),
    input,
  );
  if (!uuid.safeParse(projectId).success) return null;
  const versionId = await getDb().transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: project.id, stageState: project.stageState })
      .from(project)
      .where(
        and(eq(project.id, projectId), eq(project.ownerId, userId), isNull(project.archivedAt)),
      )
      .for("update");
    if (!owned) return null;
    if (readSectioningRecord(owned.stageState)?.state !== "failed") {
      throw new BlocksInputError("Only a run that failed can be tried again.");
    }
    const [accepted] = await tx
      .select({ id: scriptVersion.id })
      .from(scriptVersion)
      .where(
        and(
          eq(scriptVersion.projectId, projectId),
          isNull(scriptVersion.episodeId),
          eq(scriptVersion.status, "accepted"),
        ),
      )
      .orderBy(desc(scriptVersion.versionNumber))
      .limit(1);
    if (!accepted) throw new BlocksInputError("There is no accepted script to prepare.");
    await setSectioningState(
      { projectId, state: "running", scriptVersionId: accepted.id, failure: null },
      tx,
    );
    await tx.insert(projectEvent).values({
      projectId,
      userId,
      type: "sectioning.retried",
      payload: { versionId: accepted.id },
    });
    await enqueue(scriptDetectAssets, { scriptVersionId: accepted.id }, { tx });
    return accepted.id;
  });
  if (!versionId) return null;
  return getSectioningStatus(projectId, userId);
}
