import type { BlockProductionStage } from "@/server/production";
import { shotStatusLabel } from "../../../_lib/shot-status";

/** A shot's state in words: the vocabulary shared by every Production screen. */
export const blockStateLabel = (stage: BlockProductionStage) => shotStatusLabel(stage);

/** The plain notice on a shot a script edit sent back through preparation, or null. */
export function scriptChangeNotice(block: {
  scriptChanged: boolean;
  stage: BlockProductionStage;
}): string | null {
  if (!block.scriptChanged) return null;
  return block.stage === "block_review"
    ? "The script changed. Review this shot again."
    : "The script changed. This shot is being prepared again.";
}

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
