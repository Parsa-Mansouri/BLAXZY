import { getPreProductionOverview, listAssetCards, type AssetStage } from "@/server/assets";
import { kindPlural, type AssetKindKey } from "./asset-kinds";

const COLLAGE_SLOTS = 4;
const SCAN_PAGE = 24;

/** One category of the overview: its progress and the images of its collage. */
export interface CategorySummary {
  kind: AssetKindKey;
  plural: string;
  total: number;
  ready: number;
  /** One entry per frame of the collage; null is an empty frame. */
  slots: (string | null)[];
}

export interface OverviewData {
  total: number;
  ready: number;
  canComplete: boolean;
  categories: CategorySummary[];
  /** Something is being produced in the background. */
  busy: boolean;
  /** Changes whenever anything the overview shows changes. */
  signature: string;
}

const WORKING: readonly AssetStage[] = ["generating", "building_sheet"];

/** The pre-production overview with the collage frames; null when the project is not the user's. */
export async function loadOverview(
  projectId: string,
  userId: string,
): Promise<OverviewData | null> {
  const overview = await getPreProductionOverview(projectId, userId);
  if (!overview) return null;
  let busy = false;
  const parts: string[] = [`${overview.ready}/${overview.total}`];
  const categories = await Promise.all(
    overview.kinds.map(async (k): Promise<CategorySummary> => {
      const page = await listAssetCards(projectId, userId, { kind: k.kind, limit: SCAN_PAGE });
      const cards = page?.items ?? [];
      if (cards.some((c) => WORKING.includes(c.stage))) busy = true;
      const images = cards.flatMap((c) => (c.thumbnailFileId ? [c.thumbnailFileId] : []));
      const count = Math.min(k.total, COLLAGE_SLOTS);
      const slots = Array.from({ length: count }, (_, i) => images[i] ?? null);
      parts.push(
        `${k.kind}:${k.ready}/${k.total}:${slots.join(",")}:${cards.map((c) => c.stage).join(",")}`,
      );
      return { kind: k.kind, plural: kindPlural(k.kind), total: k.total, ready: k.ready, slots };
    }),
  );
  return {
    total: overview.total,
    ready: overview.ready,
    canComplete: overview.canComplete,
    categories,
    busy,
    signature: parts.join("|"),
  };
}
