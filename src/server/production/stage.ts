/**
 * Where a block stands in Production, derived from its current version and its latest live take
 * (the newest take of its lineage that is not superseded). Pure: the one definition every service
 * (overview, lists, detail, reviews, quotes, completion) uses.
 *
 * preparing → block_review (or prepare_failed) → approved → draft_generating → draft_review →
 * final_generating → final_review → done; `failed` when the latest take could not be produced
 * (a retry is available).
 */
import type { LookStatus, ProductionState, TakeStage } from "@/server/db/schema";

export const BLOCK_PRODUCTION_STAGES = [
  "preparing",
  "prepare_failed",
  "block_review",
  "approved",
  "draft_generating",
  "draft_review",
  "final_generating",
  "final_review",
  "done",
  "failed",
] as const;
export type BlockProductionStage = (typeof BLOCK_PRODUCTION_STAGES)[number];

export type StageBlock = {
  /** The script changed under the block; it waits for new blocks and cannot be worked on. */
  stale: boolean;
  productionState: ProductionState;
  approvedAt: Date | null;
};

export type StageTake = { stage: TakeStage; status: LookStatus };

/**
 * @param block the lineage's current version
 * @param latestTake the lineage's newest take that is not superseded, or null
 */
export function deriveBlockStage(
  block: StageBlock,
  latestTake: StageTake | null,
): BlockProductionStage {
  if (block.stale) return "preparing";
  switch (block.productionState) {
    case "none":
    case "pending":
      return "preparing";
    case "failed":
      return "prepare_failed";
    case "ready":
      break;
  }
  if (!latestTake || latestTake.status === "superseded") {
    return block.approvedAt ? "approved" : "block_review";
  }
  const final = latestTake.stage === "final";
  switch (latestTake.status) {
    case "pending":
      return final ? "final_generating" : "draft_generating";
    case "in_review":
      return final ? "final_review" : "draft_review";
    case "failed":
      return "failed";
    case "accepted":
      // An accepted draft always has its final (newer) in the same transaction.
      return final ? "done" : "final_generating";
    case "rejected":
      // A rejected take always has its fixed draft (newer) in the same transaction.
      return "draft_generating";
  }
}

/** A block whose dami or generation is still working (nothing new can be started on it). */
export function isBusy(block: StageBlock, latestTake: StageTake | null): boolean {
  return !block.stale && (block.productionState === "pending" || latestTake?.status === "pending");
}

export type ProductionPhase = "preparing" | "block_review" | "generating" | "finished";

export function emptyCounts(): Record<BlockProductionStage, number> {
  return Object.fromEntries(BLOCK_PRODUCTION_STAGES.map((s) => [s, 0])) as Record<
    BlockProductionStage,
    number
  >;
}

/**
 * The phase the screens show, from the per-stage counts: preparing while any block is being
 * prepared; block review while any is waiting for review or approval (or failed to prepare);
 * finished when every block is done; generating otherwise.
 */
export function derivePhase(counts: Record<BlockProductionStage, number>): ProductionPhase {
  const total = BLOCK_PRODUCTION_STAGES.reduce((sum, s) => sum + counts[s], 0);
  if (total === 0 || counts.preparing > 0) return "preparing";
  if (counts.block_review > 0 || counts.prepare_failed > 0 || counts.approved > 0) {
    return "block_review";
  }
  if (counts.done === total) return "finished";
  return "generating";
}

/** Drafts can start: some blocks are approved and none is still being prepared or reviewed. */
export function canStartDraftsFrom(counts: Record<BlockProductionStage, number>): boolean {
  return (
    counts.approved > 0 &&
    counts.preparing === 0 &&
    counts.prepare_failed === 0 &&
    counts.block_review === 0
  );
}
