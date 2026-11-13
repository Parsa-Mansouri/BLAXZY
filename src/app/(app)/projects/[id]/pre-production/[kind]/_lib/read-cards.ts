import { listAssetCards, MAX_CARD_PAGE_SIZE } from "@/server/assets";
import { clampCount, type ActionResult } from "../../../../../_lib/action";
import { ASSET_KIND_LABELS, type AssetKindKey } from "../../../_lib/asset-kinds";
import { toGalleryItem, type GalleryItem } from "../../_components/gallery-item";
import { countKindStages } from "../../_lib/load-categories";
import type { StageCounts } from "../../_lib/status-words";

export interface CardsPage {
  items: GalleryItem[];
  nextCursor: string | null;
  /** How many assets of the kind are at each stage (all of them, not only this page). */
  counts: StageCounts;
}

export const CARDS_MISSING = "This project no longer exists. It may have been archived.";
export const CARDS_MISSING_RESULT = { ok: false, error: CARDS_MISSING } as const;
export const NO_SUCH_KIND = { ok: false, error: "This kind of asset does not exist." } as const;
export const CARD_PAGE = 24;

export function asKind(value: string): AssetKindKey | null {
  return ASSET_KIND_LABELS.find((k) => k.kind === value)?.kind ?? null;
}

export async function readCards(
  projectId: string,
  userId: string,
  kind: AssetKindKey,
  cursor: string | null,
  want: number,
): Promise<CardsPage | null> {
  const counts = await countKindStages(projectId, userId, kind);
  if (!counts) return null;
  const items: GalleryItem[] = [];
  let next = cursor;
  do {
    const page = await listAssetCards(projectId, userId, {
      kind,
      cursor: next,
      limit: Math.min(want - items.length, MAX_CARD_PAGE_SIZE),
    });
    if (!page) return null;
    items.push(...page.items.map(toGalleryItem));
    next = page.nextCursor;
  } while (next && items.length < want);
  return { items, nextCursor: next, counts };
}

/** The first `count` assets of a category again, for polling. */
export async function refreshCards(
  projectId: string,
  userId: string,
  kind: string,
  count: number,
): Promise<ActionResult<CardsPage>> {
  const key = asKind(kind);
  if (!key) return NO_SUCH_KIND;
  const page = await readCards(projectId, userId, key, null, clampCount(count, CARD_PAGE, 500));
  return page ? { ok: true, data: page } : CARDS_MISSING_RESULT;
}
