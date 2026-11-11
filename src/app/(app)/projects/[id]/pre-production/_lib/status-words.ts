import type { AssetStage } from "@/server/assets";
import type { StatusTone } from "@/ui";

export type StageCounts = Partial<Record<AssetStage, number>>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a set of assets needs, in words: "1 to review · 2 need an image · 1 generating". Never a
 * total: detection may have missed assets, so "x of y" would not be true.
 */
export function statusWords(counts: StageCounts): { text: string; tone: StatusTone } {
  const n = (stage: AssetStage) => counts[stage] ?? 0;
  const review = n("look_review") + n("sheet_review");
  const failed = n("failed");
  const working = n("generating") + n("building_sheet");
  const parts: string[] = [];
  if (review > 0) parts.push(`${review} to review`);
  if (n("needs_image") > 0) parts.push(plural(n("needs_image"), "needs an image", "need an image"));
  if (n("needs_recording") > 0) {
    parts.push(plural(n("needs_recording"), "needs a recording", "need a recording"));
  }
  if (failed > 0) parts.push(plural(failed, "needs attention", "need attention"));
  if (working > 0) parts.push(`${working} generating`);
  if (parts.length === 0) {
    return n("ready") > 0
      ? { text: "All ready", tone: "done" }
      : { text: "Nothing yet", tone: "none" };
  }
  const tone: StatusTone = failed > 0 ? "failed" : review > 0 ? "waiting" : "working";
  return { text: parts.join(" · "), tone };
}

/** Counts of each stage in a list of assets. */
export function countStages(stages: readonly AssetStage[]): StageCounts {
  const counts: StageCounts = {};
  for (const stage of stages) counts[stage] = (counts[stage] ?? 0) + 1;
  return counts;
}
