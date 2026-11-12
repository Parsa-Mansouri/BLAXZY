import {
  getPreProductionOverview,
  listAssetCards,
  MAX_CARD_PAGE_SIZE,
  type AssetStage,
} from "@/server/assets";

/** Pages read per kind at most; a film with more assets than this still gets a truthful line. */
const MAX_PAGES_PER_KIND = 10;

export interface PreProductionLine {
  text: string;
  tone: "done" | "waiting" | "working" | "failed";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What Pre-production still needs, in a few words and without totals ("1 to review · 7 need an
 * image · 1 needs a recording"), for the locked Production screen. Null when the project is not
 * the user's.
 */
export async function preProductionLine(
  projectId: string,
  userId: string,
): Promise<PreProductionLine | null> {
  const overview = await getPreProductionOverview(projectId, userId);
  if (!overview) return null;
  if (overview.total === 0) return { text: "No assets yet", tone: "working" };

  const counts: Partial<Record<AssetStage, number>> = {};
  for (const { kind } of overview.kinds) {
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES_PER_KIND; page++) {
      const result: Awaited<ReturnType<typeof listAssetCards>> = await listAssetCards(
        projectId,
        userId,
        { kind, cursor, limit: MAX_CARD_PAGE_SIZE },
      );
      if (!result) return null;
      for (const card of result.items) counts[card.stage] = (counts[card.stage] ?? 0) + 1;
      cursor = result.nextCursor;
      if (!cursor) break;
    }
  }

  const review = (counts.look_review ?? 0) + (counts.sheet_review ?? 0);
  const image = counts.needs_image ?? 0;
  const recording = counts.needs_recording ?? 0;
  const working = (counts.generating ?? 0) + (counts.building_sheet ?? 0);
  const question = counts.needs_answer ?? 0;
  const failed = counts.failed ?? 0;

  const parts: string[] = [];
  if (review > 0) parts.push(`${review} to review`);
  if (image > 0) parts.push(plural(image, "needs an image", "need an image"));
  if (recording > 0) parts.push(plural(recording, "needs a recording", "need a recording"));
  if (question > 0) parts.push(plural(question, "has a question", "have a question"));
  if (failed > 0) parts.push(`${failed} failed`);
  if (working > 0) parts.push(`${working} generating`);
  if (parts.length === 0) return { text: "Every asset is ready", tone: "done" };

  const tone = failed > 0 ? "failed" : review + image + recording > 0 ? "waiting" : "working";
  return { text: parts.join(" · "), tone };
}
