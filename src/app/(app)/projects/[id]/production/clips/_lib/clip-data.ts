/**
 * Server-side reads of the clips screens, built on `@/server/production`. Used by the pages and
 * the server actions only (never by client components).
 */
import {
  getProductionOverview,
  listProductionBlocks,
  MAX_BLOCK_PAGE_SIZE,
  type ProductionBlock,
} from "@/server/production";
import { REVIEW_STAGES, type ClipTileData, type StageCounts } from "./clip-view";

/** Tiles per page of the board. */
export const BOARD_PAGE_SIZE = 24;
/** The most tiles a poll reads again (what was loaded with Load More, capped). */
const MAX_REFRESH = 400;

export const toTile = (block: ProductionBlock): ClipTileData => ({
  lineageId: block.lineageId,
  orderIndex: block.orderIndex,
  title: block.title,
  stage: block.stage,
  posterFileId: block.posterFileId,
});

export interface BoardSummary {
  counts: StageCounts;
  /** Every shot has an accepted final and the project is still in production. */
  canComplete: boolean;
  /** Every shot is final (also once the project is done). */
  allFinal: boolean;
  /** The first shot in story order waiting for review, for "Review Next". */
  firstToReview: string | null;
}

export interface BoardPage {
  tiles: ClipTileData[];
  nextCursor: string | null;
  summary: BoardSummary;
}

/** Shots of the board from `cursor`, at least `want` of them when there are that many. */
export async function readBoard(
  projectId: string,
  userId: string,
  cursor: string | null,
  want: number,
): Promise<BoardPage | null> {
  const [overview, review] = await Promise.all([
    getProductionOverview(projectId, userId),
    listProductionBlocks(projectId, userId, { limit: 1, stage: [...REVIEW_STAGES] }),
  ]);
  if (!overview || !review) return null;
  const tiles: ClipTileData[] = [];
  let next = cursor;
  const target = Math.max(1, Math.min(want, MAX_REFRESH));
  do {
    const page = await listProductionBlocks(projectId, userId, {
      cursor: next,
      limit: Math.min(target - tiles.length, MAX_BLOCK_PAGE_SIZE),
    });
    if (!page) return null;
    tiles.push(...page.items.map(toTile));
    next = page.nextCursor;
  } while (next && tiles.length < target);
  return {
    tiles,
    nextCursor: next,
    summary: {
      counts: overview.counts,
      canComplete: overview.canComplete,
      allFinal: overview.blockCount > 0 && overview.counts.done === overview.blockCount,
      firstToReview: review.items[0]?.lineageId ?? null,
    },
  };
}

export interface ShotRef {
  lineageId: string;
  orderIndex: number;
  title: string | null;
}

const toRef = (block: ProductionBlock): ShotRef => ({
  lineageId: block.lineageId,
  orderIndex: block.orderIndex,
  title: block.title,
});

/**
 * The shots before and after one shot in story order, read page by page (bounded by the project's
 * shot count). Null when the shot is not one of this project's current shots.
 */
export async function findNeighbours(
  projectId: string,
  userId: string,
  lineageId: string,
): Promise<{ previous: ShotRef | null; next: ShotRef | null } | null> {
  let cursor: string | null = null;
  let previous: ShotRef | null = null;
  let found = false;
  do {
    const page: Awaited<ReturnType<typeof listProductionBlocks>> = await listProductionBlocks(
      projectId,
      userId,
      { cursor, limit: MAX_BLOCK_PAGE_SIZE },
    );
    if (!page) return null;
    for (const block of page.items) {
      if (found) return { previous, next: toRef(block) };
      if (block.lineageId === lineageId) found = true;
      else previous = toRef(block);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return found ? { previous, next: null } : null;
}

/**
 * The next shot waiting for review after `afterOrderIndex` in story order, wrapping to the start;
 * never `exclude` (the shot just decided). Null when no other shot waits.
 */
export async function findNextToReview(
  projectId: string,
  userId: string,
  afterOrderIndex: number,
  exclude: string,
): Promise<ShotRef | null> {
  let cursor: string | null = null;
  let first: ShotRef | null = null;
  do {
    const page: Awaited<ReturnType<typeof listProductionBlocks>> = await listProductionBlocks(
      projectId,
      userId,
      { cursor, limit: MAX_BLOCK_PAGE_SIZE, stage: [...REVIEW_STAGES] },
    );
    if (!page) return null;
    for (const block of page.items) {
      if (block.lineageId === exclude) continue;
      if (block.orderIndex > afterOrderIndex) return toRef(block);
      first ??= toRef(block);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return first;
}
