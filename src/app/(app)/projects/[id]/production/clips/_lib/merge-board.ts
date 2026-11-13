import { mergeLoadedPages } from "@/app/(app)/_lib/use-server-snapshot";
import type { BoardPage } from "./clip-data";

/** A fresh server board over the local one: shots loaded further down are kept. */
export function mergeBoard(current: BoardPage, fresh: BoardPage): BoardPage {
  const merged = mergeLoadedPages({
    current: current.tiles,
    currentCursor: current.nextCursor,
    fresh: fresh.tiles,
    freshCursor: fresh.nextCursor,
    id: (tile) => tile.lineageId,
  });
  return { ...fresh, tiles: merged.items, nextCursor: merged.cursor };
}
