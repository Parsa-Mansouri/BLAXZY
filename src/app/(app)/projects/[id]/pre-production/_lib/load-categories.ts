import {
  getPreProductionOverview,
  listAssetCards,
  MAX_CARD_PAGE_SIZE,
  type AssetStage,
} from "@/server/assets";
import { kindPlural, type AssetKindKey } from "../../_lib/asset-kinds";
import { countStages, type StageCounts } from "./status-words";

/** Most assets of one kind the overview reads (a project has far fewer). */
const MAX_PER_KIND = 500;

export interface OverviewAsset {
  id: string;
  name: string;
  stage: AssetStage;
  thumbnailFileId: string | null;
}

/** One kind of asset on the overview: every asset of it, in display order, and its counts. */
export interface OverviewCategory {
  kind: AssetKindKey;
  plural: string;
  assets: OverviewAsset[];
  counts: StageCounts;
}

export interface PreProductionData {
  total: number;
  ready: number;
  /** Every asset is ready and the project is still in pre-production. */
  canComplete: boolean;
  categories: OverviewCategory[];
  /** Something is being produced in the background. */
  busy: boolean;
  /** Changes whenever anything the overview shows changes. */
  signature: string;
}

const WORKING: readonly AssetStage[] = ["generating", "building_sheet"];

/**
 * How many assets of one kind are at each stage, read a page at a time (bounded). Null when the
 * project is not the user's.
 */
export async function countKindStages(
  projectId: string,
  userId: string,
  kind: AssetKindKey,
): Promise<StageCounts | null> {
  const stages: AssetStage[] = [];
  let cursor: string | null = null;
  do {
    const page = await listAssetCards(projectId, userId, {
      kind,
      cursor,
      limit: MAX_CARD_PAGE_SIZE,
    });
    if (!page) return null;
    // Skipped assets are not designed: they are not counted (as on the overview).
    for (const card of page.items) if (card.asset.priority !== "skipped") stages.push(card.stage);
    cursor = page.nextCursor;
  } while (cursor && stages.length < MAX_PER_KIND);
  return countStages(stages);
}

/** The overview with every asset's stage; null when the project is not the user's. */
export async function loadCategories(
  projectId: string,
  userId: string,
): Promise<PreProductionData | null> {
  const overview = await getPreProductionOverview(projectId, userId);
  if (!overview) return null;
  const categories = await Promise.all(
    overview.kinds.map(async ({ kind }): Promise<OverviewCategory> => {
      const assets: OverviewAsset[] = [];
      let cursor: string | null = null;
      do {
        const page = await listAssetCards(projectId, userId, {
          kind,
          cursor,
          limit: MAX_CARD_PAGE_SIZE,
        });
        if (!page) break;
        for (const card of page.items) {
          if (card.asset.priority === "skipped") continue;
          assets.push({
            id: card.asset.id,
            name: card.asset.name,
            stage: card.stage,
            thumbnailFileId: card.thumbnailFileId,
          });
        }
        cursor = page.nextCursor;
      } while (cursor && assets.length < MAX_PER_KIND);
      return {
        kind,
        plural: kindPlural(kind),
        assets,
        counts: countStages(assets.map((a) => a.stage)),
      };
    }),
  );
  const busy = categories.some((c) => c.assets.some((a) => WORKING.includes(a.stage)));
  const signature = [
    `${overview.ready}/${overview.total}`,
    ...categories.map(
      (c) =>
        `${c.kind}:${c.assets.map((a) => `${a.id}=${a.stage}=${a.thumbnailFileId ?? "-"}`).join(",")}`,
    ),
  ].join("|");
  return {
    total: overview.total,
    ready: overview.ready,
    canComplete: overview.canComplete,
    categories,
    busy,
    signature,
  };
}
