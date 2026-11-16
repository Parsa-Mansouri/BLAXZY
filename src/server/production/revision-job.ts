/**
 * The `block.revise` job's data side (worker only): the Block Revision input assembled from the
 * database, and the revised block turned into what the new version stores. No Claude here: the
 * handler runs the dami between the two. Every failure the user can act on is a
 * `ProductionInputError` with a plain message.
 *
 * Input, field by field: `current_block` the previous version's stored Director data; the
 * continuity bible, platform numbers, Creative Bible (or the stub) and the language from the
 * Director run the block was written under; `script_excerpt` the block's excerpt; `neighbours` the
 * previous and next current blocks' hand-offs; `requests` and the notes, issues and keep list from
 * the review's `revisionRequest`; `asset_correction` from the references the block had against
 * the ones it has; `attempt_history` from the earlier versions of the lineage.
 */
import { and, asc, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { z } from "zod";
import { getNextCurrentBlock, getPreviousCurrentBlock, type PromptBlock } from "@/server/blocks";
import {
  continuityBibleSchema,
  formatAssetRef,
  tagAssetIds,
  type BlockRevisionInput,
  type BlockRevisionOutput,
} from "@/server/damis";
import { getDb } from "@/server/db/client";
import { promptBlock, review } from "@/server/db/schema";
import {
  bindingsMap,
  directionContextSchema,
  getFinishedDirection,
  type DirectionBinding,
} from "@/server/direction";
import { ProductionInputError } from "./errors";
import { prepareBlockPrompt, type PreparedPrompt } from "./binding";
import type { PreparationJob } from "./jobs";
import { assetCorrectionFor, directedBlockOf, isEmptyCorrection } from "./revision";
import { type RevisionRequest, revisionRequestSchema } from "./revision-request";

const MAX_HISTORY_VERSIONS = 20;

/** What the revision stored under `direction.revision` (the part attempt history reads). */
const storedRevisionSchema = z.object({
  fix_map: z.array(
    z.object({
      source: z.string(),
      ref: z.string(),
      window: z.string(),
      level: z.number().int(),
      change: z.string(),
    }),
  ),
});

type Attempt = NonNullable<BlockRevisionInput["attempt_history"]>[number];

/**
 * Earlier attempts of this lineage, kept simple: for every earlier version made by a revision,
 * its fixes for confirmed video-review issues (the ones with a kind and an escalation level), each
 * `not_fixed` when the request that followed on that version names the same issue kind and window
 * again, else `fixed`. `video_version` repeats the block version (the take is not tracked).
 */
async function attemptHistory(block: PromptBlock): Promise<Attempt[]> {
  const db = getDb();
  const versions = await db
    .select({
      id: promptBlock.id,
      versionNumber: promptBlock.versionNumber,
      direction: promptBlock.direction,
    })
    .from(promptBlock)
    .where(
      and(
        eq(promptBlock.lineageId, block.lineageId),
        lt(promptBlock.versionNumber, block.versionNumber),
      ),
    )
    .orderBy(asc(promptBlock.versionNumber))
    .limit(MAX_HISTORY_VERSIONS);
  if (versions.length === 0) return [];
  const rows = await db
    .select({
      subjectId: review.subjectId,
      request: review.revisionRequest,
      createdAt: review.createdAt,
    })
    .from(review)
    .where(
      and(
        eq(review.subjectType, "prompt_block"),
        inArray(
          review.subjectId,
          versions.map((v) => v.id),
        ),
        eq(review.decision, "rejected"),
        isNotNull(review.revisionRequest),
      ),
    )
    .orderBy(desc(review.createdAt));
  const requestOf = new Map<string, RevisionRequest>();
  for (const row of rows) {
    const parsed = revisionRequestSchema.safeParse(row.request);
    if (parsed.success && !requestOf.has(row.subjectId)) requestOf.set(row.subjectId, parsed.data);
  }
  const attempts: Attempt[] = [];
  versions.forEach((version, i) => {
    const made = directedBlockOf(version);
    const raw = version.direction as { revision?: unknown } | null;
    const stored = storedRevisionSchema.safeParse(raw?.revision);
    const answered = i > 0 ? requestOf.get(versions[i - 1]?.id ?? "") : undefined;
    const followed = requestOf.get(version.id);
    if (!made || !stored.success || !answered) return;
    const fixes = stored.data.fix_map
      .filter((f) => f.source === "issue")
      .flatMap((f) => {
        const issue = answered.observedIssues.find((o) => o.issue_id === f.ref);
        if (!issue) return [];
        const again = followed?.observedIssues.some(
          (o) => o.kind === issue.kind && o.window === issue.window,
        );
        return [
          {
            issue_kind: issue.kind,
            window: issue.window,
            level: Math.min(4, Math.max(1, f.level)),
            change: f.change,
            outcome: again ? ("not_fixed" as const) : ("fixed" as const),
          },
        ];
      });
    if (fixes.length > 0) {
      attempts.push({
        block_version: made.version,
        video_version: made.version,
        route: "revise",
        fixes,
      });
    }
  });
  return attempts;
}

export type RevisionContext = {
  input: BlockRevisionInput;
  /** The previous version's stored Director data, the base of the revised block's. */
  parentDirection: Record<string, unknown>;
  bindings: DirectionBinding[];
};

/** The Block Revision input for a pending revision version, or a `ProductionInputError`. */
export async function buildBlockRevisionInput(job: PreparationJob): Promise<RevisionContext> {
  const { block, revision } = job;
  if (!revision)
    throw new ProductionInputError("The review this shot answers is missing. Ask again.");
  const { parent, request } = revision;
  const current = directedBlockOf(parent);
  if (!current) {
    throw new ProductionInputError(
      "This shot was cut before the Director existed, so it cannot be revised. Direct the script again.",
    );
  }
  const run = await getFinishedDirection(block.projectId, block.scriptVersionId);
  const context = run ? directionContextSchema.safeParse(run.context) : null;
  const header = run
    ? z.object({ continuity_bible: continuityBibleSchema }).safeParse(run.header)
    : null;
  if (!context?.success || !header?.success) {
    throw new ProductionInputError(
      "The Director's notes for this film are missing. Direct the script again.",
    );
  }
  const bible = context.data.creative_bible;

  const before = await getPreviousCurrentBlock(block);
  const after = await getNextCurrentBlock(block);
  const previousBlock = before ? directedBlockOf(before) : null;
  const nextBlock = after ? directedBlockOf(after) : null;

  const correction = assetCorrectionFor(
    current,
    context.data.bindings,
    parent.assetRefs,
    block.assetRefs,
  );
  const notes = request.note?.trim();
  const timed = request.timedNotes.filter((n) => n.toS > n.fromS);
  const requests: BlockRevisionInput["requests"] = {
    ...(isEmptyCorrection(correction) ? {} : { asset_correction: correction }),
    ...(request.regenerate ? { regenerate: true } : {}),
    ...(notes ? { director_notes: notes.slice(0, 4000) } : {}),
    ...(request.observedIssues.length > 0
      ? { observed_issues: request.observedIssues.map((i) => i.issue_id) }
      : {}),
  };
  if (Object.keys(requests).length === 0 && timed.length === 0) {
    throw new ProductionInputError("There is nothing to change in this shot. Describe the change.");
  }
  const history = await attemptHistory(block);
  const input: BlockRevisionInput = {
    ui_language: bible.project_frame.ui_language?.trim() || "en",
    platform_config: context.data.platform_config,
    creative_bible: bible,
    continuity_bible: header.data.continuity_bible,
    script_excerpt: block.scriptExcerpt.trim().slice(0, 20_000) || block.title || "Shot",
    neighbours: {
      previous: previousBlock
        ? {
            end_state: previousBlock.end_state,
            end_staging: previousBlock.end_staging,
            in_progress_at_end: previousBlock.in_progress_at_end,
            last_window: previousBlock.shots.at(-1)?.window ?? "",
          }
        : null,
      next: nextBlock
        ? {
            start_state: nextBlock.start_state,
            start_staging: nextBlock.start_staging,
            continuity_type: nextBlock.continuity.type,
          }
        : null,
    },
    current_block: current,
    ...(request.observedIssues.length > 0
      ? { video_review: { issues: request.observedIssues, keep_candidates: [] } }
      : {}),
    ...(timed.length > 0
      ? {
          timed_notes: timed.map((n) => ({
            from_s: n.fromS,
            to_s: n.toS,
            category: "directing" as const,
            note: n.text,
          })),
        }
      : {}),
    ...(request.keep.length > 0 ? { keep: request.keep } : {}),
    ...(history.length > 0 ? { attempt_history: history } : {}),
    requests,
  };
  return {
    input,
    parentDirection: (parent.direction ?? {}) as Record<string, unknown>,
    bindings: context.data.bindings,
  };
}

/** What the new version stores: the revised block, its tagged prompt and its bound production. */
export type RevisionStorage = {
  revised: { direction: unknown; prompt: string; assetRefs: string[] };
  prepared: PreparedPrompt;
  /** The change log first, then the notes of binding the references. */
  notes: string[];
};

/**
 * The revised block as stored: the previous Director data with the fields Block Revision rewrote,
 * its report under `revision`, the prompt re-tagged (`[kind:Name]`), the references and the
 * production binding (the same code as a Director block's).
 */
export function revisionStorage(
  ctx: RevisionContext,
  block: Pick<PromptBlock, "assetRefs" | "productionAssetRefs">,
  output: BlockRevisionOutput,
  ready: ReadonlyMap<string, string>,
): RevisionStorage {
  const tagged = tagAssetIds(output.prompt_text, bindingsMap(ctx.bindings));
  const byId = new Map(ctx.bindings.map((b) => [b.id, b] as const));
  const known = new Set(ctx.bindings.map((b) => formatAssetRef(b.kind, b.name)));
  const listed = [...output.assets.characters, ...output.assets.locations, ...output.assets.props]
    .map((id) => byId.get(id))
    .flatMap((b) => (b && b.reference !== false ? [formatAssetRef(b.kind, b.name)] : []));
  // References the user attached that the Director never knew stay attached.
  const extras = block.assetRefs.filter((r) => !known.has(r));
  const assetRefs = [...new Set([...tagged.assetRefs, ...listed, ...extras])];

  const direction = {
    ...ctx.parentDirection,
    version: output.version,
    duration_s: output.duration_s,
    start_state: output.start_state,
    end_state: output.end_state,
    start_staging: output.start_staging,
    end_staging: output.end_staging,
    staging_meaning: output.staging_meaning,
    opening_frame: output.opening_frame,
    in_progress_at_end: output.in_progress_at_end,
    camera_rationale: output.camera_rationale,
    editing_rationale: output.editing_rationale,
    assets: output.assets,
    budgets: output.budgets,
    shots: output.shots,
    applied_rules: output.applied_rules,
    prompt_text: output.prompt_text,
    word_count: output.word_count,
    revision: {
      dami_version: output.dami_version,
      based_on_version: output.based_on_version,
      change_log: output.change_log,
      fix_map: output.fix_map,
      expected_checks: output.expected_checks,
      flags: output.flags,
      slider_state: output.slider_state,
    },
  };
  const prepared = prepareBlockPrompt(
    { prompt: tagged.prompt, productionAssetRefs: block.productionAssetRefs },
    ready,
  );
  return {
    revised: { direction, prompt: tagged.prompt, assetRefs },
    prepared,
    notes: [...output.change_log, ...prepared.notes],
  };
}
