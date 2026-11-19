/**
 * Block revisions: the next version of a block, revised by Block Revision from a review's
 * `revisionRequest` (see `revision-request.ts`). Every revision is "create the next block version
 * and queue `block.revise` for it"; the review row the job reads is a `prompt_block` review of the
 * version being revised (a take review gets a linking copy, so the job finds its request in one
 * place). Also: the asset correction a changed asset list stands for, and the one-click update of
 * the next shot after a revision moved the hand-off between them.
 */
import { and, eq } from "drizzle-orm";
import {
  createNextBlockVersion,
  getBlockVersion,
  getCurrentBlock,
  parseBlockDirection,
  type PromptBlock,
} from "@/server/blocks";
import { formatAssetRef, isVoiceRef, storedBlockSchema, type DirectorBlock } from "@/server/damis";
import { type DbTx, getDb } from "@/server/db/client";
import { review } from "@/server/db/schema";
import {
  directionContextSchema,
  getFinishedDirection,
  type DirectionBinding,
} from "@/server/direction";
import { logProjectEvent } from "@/server/projects";
import { isUuid } from "./access";
import { ProductionInputError } from "./errors";
import { enqueuePreparation } from "./preparation";
import { type RevisionRequest, revisionRequestSchema } from "./revision-request";

export const NOT_DIRECTED_MESSAGE =
  "This shot was cut before the Director existed, so it cannot be revised. Direct the script again to get a revisable shot.";

/** The block's Director data in the shape Block Revision reads, or null for an older block. */
export function directedBlockOf(block: Pick<PromptBlock, "direction">): DirectorBlock | null {
  if (!parseBlockDirection(block.direction)) return null;
  // A block directed by an older Director (v1.3) is upgraded to the current shape.
  const parsed = storedBlockSchema.safeParse(block.direction);
  return parsed.success ? parsed.data : null;
}

/** What a changed asset list asks of Block Revision, in the Director's asset ids. */
export type AssetCorrection = {
  add: string[];
  remove: string[];
  swap: { from: string; to: string }[];
};

export function isEmptyCorrection(c: AssetCorrection | undefined): boolean {
  return !c || c.add.length + c.remove.length + c.swap.length === 0;
}

/**
 * The asset correction from the references a block had to the ones it has now: assets the
 * Director knows (its bindings) that were added or removed. One added and one removed asset of the
 * same kind are a swap. Assets the Director never listed cannot be handed over by id: they are
 * attached as references only (binding names them in an "ALSO IN THIS SHOT" line).
 */
export function assetCorrectionFor(
  direction: DirectorBlock,
  bindings: readonly DirectionBinding[],
  oldRefs: readonly string[],
  newRefs: readonly string[],
): AssetCorrection {
  const byRef = new Map(bindings.map((b) => [formatAssetRef(b.kind, b.name), b] as const));
  const inBlock = new Set([
    ...direction.assets.characters,
    ...direction.assets.locations,
    ...direction.assets.props,
  ]);
  const before = new Set(oldRefs.filter((r) => !isVoiceRef(r)));
  const after = new Set(newRefs.filter((r) => !isVoiceRef(r)));
  const removed = [...before]
    .filter((r) => !after.has(r))
    .flatMap((r) => {
      const b = byRef.get(r);
      return b && inBlock.has(b.id) ? [b] : [];
    });
  const added = [...after]
    .filter((r) => !before.has(r))
    .flatMap((r) => {
      const b = byRef.get(r);
      return b && !inBlock.has(b.id) ? [b] : [];
    });
  const correction: AssetCorrection = { add: [], remove: [], swap: [] };
  const pool = [...added];
  for (const gone of removed) {
    const i = pool.findIndex((a) => a.kind === gone.kind);
    if (i >= 0) {
      const [to] = pool.splice(i, 1);
      if (to) correction.swap.push({ from: gone.id, to: to.id });
    } else {
      correction.remove.push(gone.id);
    }
  }
  correction.add = pool.map((b) => b.id);
  return correction;
}

/**
 * The asset correction the new list of references stands for on a directed block, or null when the
 * block is not directed or the Director's notes for it are gone (the change is then only a new
 * binding of references).
 */
export async function assetCorrectionForChange(
  block: PromptBlock,
  newRefs: readonly string[],
): Promise<AssetCorrection | null> {
  const directed = directedBlockOf(block);
  if (!directed) return null;
  const run = await getFinishedDirection(block.projectId, block.scriptVersionId);
  if (!run) return null;
  const context = directionContextSchema.safeParse(run.context);
  if (!context.success) return null;
  return assetCorrectionFor(directed, context.data.bindings, block.assetRefs, newRefs);
}

/** A request that asks for nothing in particular: the assets changed (see `assetCorrectionFor`). */
export const ASSETS_ONLY_REQUEST: RevisionRequest = {
  source: "block_review",
  timedNotes: [],
  observedIssues: [],
  keep: [],
  regenerate: false,
};

/**
 * Creates the next version of the block `blockId` (the version being revised, which must still be
 * its lineage's current one) and queues `block.revise` for it, on `tx` when given (the caller's
 * transaction: the version, the linking review and the job commit with its own writes) or in a
 * transaction of its own. `reviewId` is the review that carries the `revisionRequest`: a review
 * of the block version (a block review) or of a take (a take review routed to "revise"). The
 * caller has checked ownership and the stage; this locks and checks the version. Returns the new
 * version (pending).
 */
export async function requestBlockRevision(input: {
  tx?: DbTx;
  blockId: string;
  userId: string;
  reviewId: string;
  /** Asset changes the new version carries (the asset picker). */
  changes?: { assetRefs: string[]; productionAssetRefs: string[] };
}): Promise<PromptBlock> {
  if (!input.tx) {
    return getDb().transaction((tx) => requestBlockRevision({ ...input, tx }));
  }
  const tx = input.tx;
  if (!isUuid(input.blockId) || !isUuid(input.reviewId)) {
    throw new ProductionInputError("The review this shot answers is missing. Ask again.");
  }
  const block = await getBlockVersion(input.blockId, tx);
  if (!block || block.supersededAt) {
    throw new ProductionInputError("This shot changed meanwhile. Reload it and try again.");
  }
  const locked = await getCurrentBlock(block.lineageId, tx, true);
  if (locked?.id !== block.id) {
    throw new ProductionInputError("This shot changed meanwhile. Reload it and try again.");
  }
  const [row] = await tx
    .select()
    .from(review)
    .where(and(eq(review.id, input.reviewId), eq(review.projectId, block.projectId)))
    .limit(1);
  const request = row?.revisionRequest
    ? revisionRequestSchema.safeParse(row.revisionRequest)
    : null;
  if (!row || !request?.success) {
    throw new ProductionInputError("The review this shot answers is missing. Ask again.");
  }
  const onBlock = row.subjectType === "prompt_block" && row.subjectId === block.id;
  if (!onBlock) {
    // A take review: the job reads the request from a review of the block version itself.
    await tx.insert(review).values({
      projectId: block.projectId,
      userId: input.userId,
      subjectType: "prompt_block",
      subjectId: block.id,
      decision: "rejected",
      note: request.data.note ?? null,
      revisionRequest: request.data,
      damiRunId: block.productionDamiRunId,
    });
  }
  const next = await createNextBlockVersion(
    block,
    { productionState: "pending", ...(input.changes ?? {}) },
    tx,
  );
  await logProjectEvent(tx, {
    projectId: block.projectId,
    userId: input.userId,
    type: "production.block_revision_requested",
    payload: {
      lineageId: block.lineageId,
      blockId: block.id,
      nextBlockId: next.id,
      reviewId: input.reviewId,
      source: request.data.source,
      regenerate: request.data.regenerate,
    },
  });
  await enqueuePreparation(tx, next, true);
  return next;
}

/** The text the next shot is asked to follow: the previous shot's new ending. */
export function handOffNote(previous: DirectorBlock, title: string): string {
  return [
    `The shot before this one ("${title}") was revised and now ends differently.`,
    `It now ends with: ${previous.end_state}`,
    "Start this shot from that ending (its staging and what is in progress). Keep this shot's story, dialogue and ending as they are.",
  ]
    .join(" ")
    .slice(0, 2000);
}
