import type { BlockProductionStage } from "@/server/production";

/**
 * The one vocabulary for a shot's state in Production: the shots list, a shot's page, the clips
 * board and a clip's page all use it.
 */
export const SHOT_STATUS_LABELS: Record<BlockProductionStage, string> = {
  preparing: "Preparing",
  prepare_failed: "Needs Attention",
  block_review: "Review Shot",
  approved: "Approved",
  draft_generating: "Rendering Draft",
  draft_review: "Review Draft",
  final_generating: "Rendering Final",
  final_review: "Review Final",
  done: "Final",
  failed: "Needs Attention",
};

export const shotStatusLabel = (stage: BlockProductionStage) => SHOT_STATUS_LABELS[stage];
