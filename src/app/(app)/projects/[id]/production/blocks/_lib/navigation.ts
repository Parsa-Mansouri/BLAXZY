import { listProductionBlocks, MAX_BLOCK_PAGE_SIZE } from "@/server/production";
import { blockHref, blocksHref } from "../../../_lib/production-routes";

export interface Neighbours {
  /** The shot's place in the story (1-based). */
  position: number;
  previousHref: string | null;
  nextHref: string | null;
}

/**
 * The shots before and after one shot, found by walking the project's shots a page at a time.
 * Null when the shot is not one of the project's current shots.
 */
export async function findNeighbours(
  projectId: string,
  userId: string,
  lineageId: string,
): Promise<Neighbours | null> {
  let previous: string | null = null;
  let cursor: string | null = null;
  let found: { position: number } | null = null;
  do {
    const page: Awaited<ReturnType<typeof listProductionBlocks>> = await listProductionBlocks(
      projectId,
      userId,
      { cursor, limit: MAX_BLOCK_PAGE_SIZE },
    );
    if (!page) return null;
    for (const block of page.items) {
      if (found) {
        return {
          position: found.position,
          previousHref: previous ? blockHref(projectId, previous) : null,
          nextHref: blockHref(projectId, block.lineageId),
        };
      }
      if (block.lineageId === lineageId) {
        found = { position: block.orderIndex + 1 };
        continue;
      }
      previous = block.lineageId;
    }
    cursor = page.nextCursor;
  } while (cursor);
  return found
    ? {
        position: found.position,
        previousHref: previous ? blockHref(projectId, previous) : null,
        nextHref: null,
      }
    : null;
}

/** The next shot after `orderIndex` that waits for review (wrapping to the start), or the list. */
export async function nextToReviewHref(
  projectId: string,
  userId: string,
  orderIndex: number,
  exceptLineageId: string,
): Promise<string> {
  const waiting: { lineageId: string; orderIndex: number }[] = [];
  let cursor: string | null = null;
  do {
    const page: Awaited<ReturnType<typeof listProductionBlocks>> = await listProductionBlocks(
      projectId,
      userId,
      { cursor, limit: MAX_BLOCK_PAGE_SIZE, stage: ["block_review", "prepare_failed"] },
    );
    if (!page) break;
    for (const block of page.items) {
      if (block.lineageId !== exceptLineageId) waiting.push(block);
    }
    cursor = page.nextCursor;
  } while (cursor);
  const next = waiting.find((b) => b.orderIndex > orderIndex) ?? waiting[0];
  return next ? blockHref(projectId, next.lineageId) : blocksHref(projectId);
}
