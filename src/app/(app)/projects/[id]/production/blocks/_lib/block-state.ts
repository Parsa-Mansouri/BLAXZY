import type { BlockProductionStage } from "@/server/production";

/** The one vocabulary for a shot's state in the review screens. */
export const BLOCK_STATE_LABELS: Record<BlockProductionStage, string> = {
  preparing: "Preparing",
  prepare_failed: "Needs Attention",
  block_review: "Review",
  approved: "Approved",
  draft_generating: "Making Draft",
  draft_review: "Review Draft",
  final_generating: "Making Final",
  final_review: "Review Final",
  done: "Finished",
  failed: "Needs Attention",
};

export const blockStateLabel = (stage: BlockProductionStage) => BLOCK_STATE_LABELS[stage];

/** Shots that wait for the user to decide before drafts can start. */
export function needsReview(stage: BlockProductionStage): boolean {
  return stage === "block_review" || stage === "prepare_failed";
}

type Counts = Partial<Record<BlockProductionStage, number>>;

/**
 * What needs the user, in words and without a total ("3 to review", "All shots are approved.").
 * Empty when nothing is known yet.
 */
export function attentionWords(counts: Counts): string {
  const preparing = counts.preparing ?? 0;
  const review = counts.block_review ?? 0;
  const failed = counts.prepare_failed ?? 0;
  const approved = counts.approved ?? 0;
  const parts: string[] = [];
  if (preparing > 0) parts.push(`${preparing} preparing`);
  if (review > 0) parts.push(`${review} to review`);
  if (failed > 0) parts.push(`${failed} ${failed === 1 ? "needs" : "need"} attention`);
  if (parts.length > 0) return `${parts.join(", ")}.`.replace(/^./, (c) => c.toUpperCase());
  if (approved > 0) return "All shots are approved.";
  return "";
}
