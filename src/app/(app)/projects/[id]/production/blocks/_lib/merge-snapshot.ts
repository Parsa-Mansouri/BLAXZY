import { mergeLoadedPages } from "@/app/(app)/_lib/use-server-snapshot";
import type { BlocksSnapshot } from "../actions";

/** A fresh server snapshot over the local one: shots loaded further down are kept. */
export function mergeBlocksSnapshot(
  current: BlocksSnapshot,
  fresh: BlocksSnapshot,
): BlocksSnapshot {
  const merged = mergeLoadedPages({
    current: current.items,
    currentCursor: current.nextCursor,
    fresh: fresh.items,
    freshCursor: fresh.nextCursor,
    id: (block) => block.lineageId,
  });
  return { ...fresh, items: merged.items, nextCursor: merged.cursor };
}
