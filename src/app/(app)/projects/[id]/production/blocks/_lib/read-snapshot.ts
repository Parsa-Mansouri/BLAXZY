import {
  getProductionOverview,
  listProductionBlocks,
  MAX_BLOCK_PAGE_SIZE,
  type BlockProductionStage,
  type ProductionBlock,
  type ProductionPhase,
} from "@/server/production";
import { clampCount, type ActionResult } from "../../../../../_lib/action";

export interface BlocksSnapshot {
  items: ProductionBlock[];
  nextCursor: string | null;
  counts: Record<BlockProductionStage, number>;
  phase: ProductionPhase;
  projectStage: "production" | "done";
  canStartDrafts: boolean;
}

export const SHOTS_MISSING = "This shot is no longer available. Go back to the shots and reload.";
export const SHOT_PAGE = 50;

export async function readSnapshot(
  projectId: string,
  userId: string,
  cursor: string | null,
  want: number,
): Promise<BlocksSnapshot | null> {
  const overview = await getProductionOverview(projectId, userId);
  if (!overview) return null;
  const items: ProductionBlock[] = [];
  let next = cursor;
  do {
    const page = await listProductionBlocks(projectId, userId, {
      cursor: next,
      limit: Math.min(want - items.length, MAX_BLOCK_PAGE_SIZE),
    });
    if (!page) return null;
    items.push(...page.items);
    next = page.nextCursor;
  } while (next && items.length < want);
  return {
    items,
    nextCursor: next,
    counts: overview.counts,
    phase: overview.phase,
    projectStage: overview.projectStage,
    canStartDrafts: overview.canStartDrafts,
  };
}

/** The first `count` shots again with the counts, for polling. */
export async function refreshSnapshot(
  projectId: string,
  userId: string,
  count: number,
): Promise<ActionResult<BlocksSnapshot>> {
  const snapshot = await readSnapshot(projectId, userId, null, clampCount(count, SHOT_PAGE, 500));
  return snapshot ? { ok: true, data: snapshot } : { ok: false, error: SHOTS_MISSING };
}
