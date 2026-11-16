/** Replacing a project's current blocks with a new direction, and marking them stale. */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { isVoiceRef } from "@/server/damis";
import { type DbTx, getDb } from "@/server/db/client";
import { project, projectEvent, promptBlock, scriptVersion } from "@/server/db/schema";
import { current, parse, type PromptBlock, uuid } from "./common";
import { applyRewrites, matchPrevious, normalizeExcerpt, sameAssets } from "./lineage";
import { REF_REWRITTEN_EVENT } from "./rewrite";

export type ReplaceBlocksResult = {
  created: number;
  carried: number;
  superseded: number;
  reset: number;
  /** Set when nothing changed because the version is not the newest accepted one any more. */
  skipped?: "not_latest";
};

const directedBlockSchema = z.object({
  title: z.string(),
  scriptExcerpt: z.string().min(1),
  prompt: z.string().min(1),
  durationSeconds: z.number().int().positive(),
  assetRefs: z.array(z.string()),
  orderIndex: z.number().int().min(0),
  /** The dami run that produced this block, when known (one run per batch). */
  damiRunId: uuid.optional(),
  /** The Director's data for the block (output_22), stored as it is. */
  direction: z.unknown().optional(),
});

/** A block as the Director pipeline hands it over (see `direction/blocks.ts`). */
export type DirectedBlock = z.input<typeof directedBlockSchema>;

const replaceBlocksSchema = z.object({
  projectId: uuid,
  scriptVersionId: uuid,
  blocks: z
    .array(directedBlockSchema)
    .min(1, "The Director returned no blocks.")
    // The order is the film's: two blocks in one place would also share a clip's file name.
    .refine((blocks) => new Set(blocks.map((b) => b.orderIndex)).size === blocks.length, {
      message: "The Director returned two blocks in the same place.",
    }),
  damiRunIds: z.array(uuid),
});

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
export async function replaceBlocks(
  input: {
    projectId: string;
    scriptVersionId: string;
    blocks: DirectedBlock[];
    damiRunIds: string[];
  },
  executor?: DbTx,
): Promise<ReplaceBlocksResult> {
  const { projectId, scriptVersionId, blocks, damiRunIds } = parse(replaceBlocksSchema, input);
  const run = async (tx: DbTx): Promise<ReplaceBlocksResult> => {
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
        // The Director's notes always describe the newest run, even for a carried block.
        direction: block.direction ?? null,
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
  };
  // Inside the caller's transaction when given (the direction's own store), else its own.
  return executor ? run(executor) : getDb().transaction(run);
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
