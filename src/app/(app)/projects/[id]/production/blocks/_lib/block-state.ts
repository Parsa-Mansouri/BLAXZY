import type { BlockProductionStage } from "@/server/production";

/** Status colours of the kit's StatusLine / StatusDot. */
export type Tone = "done" | "waiting" | "working" | "failed";

/** The one vocabulary for a shot's state in the review screens. */
export const BLOCK_STATE_LABELS: Record<BlockProductionStage, string> = {
  preparing: "Preparing",
  prepare_failed: "Failed",
  block_review: "To Review",
  approved: "Approved",
  draft_generating: "Making Draft",
  draft_review: "Review Draft",
  final_generating: "Making Final",
  final_review: "Review Final",
  done: "Finished",
  failed: "Failed",
};

/** Colour of a shot's state: amber waits for the user, grey works, green is done, red failed. */
export const BLOCK_STATE_TONES: Record<BlockProductionStage, Tone> = {
  preparing: "working",
  prepare_failed: "failed",
  block_review: "waiting",
  approved: "done",
  draft_generating: "working",
  draft_review: "waiting",
  final_generating: "working",
  final_review: "waiting",
  done: "done",
  failed: "failed",
};

export const blockStateLabel = (stage: BlockProductionStage) => BLOCK_STATE_LABELS[stage];

/** Shots that wait for the user to decide before drafts can start. */
export function needsReview(stage: BlockProductionStage): boolean {
  return stage === "block_review" || stage === "prepare_failed";
}

type Counts = Partial<Record<BlockProductionStage, number>>;

/**
 * What needs the user, in a few words and without a total ("2 to review · 1 failed",
 * "Every shot is approved"). Empty when nothing is known yet.
 */
export function attentionWords(counts: Counts): string {
  const preparing = counts.preparing ?? 0;
  const review = counts.block_review ?? 0;
  const failed = counts.prepare_failed ?? 0;
  const approved = counts.approved ?? 0;
  const parts: string[] = [];
  if (review > 0) parts.push(`${review} to review`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (preparing > 0) parts.push(`${preparing} preparing`);
  if (parts.length > 0) return parts.join(" · ");
  if (approved > 0) return "Every shot is approved";
  return "";
}

/** The colour of the status line that goes with `attentionWords`. */
export function attentionTone(counts: Counts): Tone {
  if ((counts.prepare_failed ?? 0) > 0) return "failed";
  if ((counts.block_review ?? 0) > 0) return "waiting";
  if ((counts.preparing ?? 0) > 0) return "working";
  return "done";
}
