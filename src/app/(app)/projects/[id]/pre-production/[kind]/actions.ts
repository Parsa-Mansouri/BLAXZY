"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import {
  addAsset,
  AssetInputError,
  getPreProductionOverview,
  listAssetCards,
  mergeAssets,
  MAX_CARD_PAGE_SIZE,
} from "@/server/assets";
import { ASSET_KIND_LABELS, type AssetKindKey } from "../../_lib/asset-kinds";
import type { GalleryItem } from "../_components/asset-gallery";
import { toGalleryItem } from "../_components/gallery-item";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

export interface CardsPage {
  items: GalleryItem[];
  nextCursor: string | null;
  total: number;
  ready: number;
}

const MISSING = "This project no longer exists. It may have been archived.";
const SERVER_PROBLEM = "The server had a problem. Try again in a moment.";

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof AssetInputError) return { ok: false, error: error.message };
  console.error("[category actions]", error);
  return { ok: false, error: SERVER_PROBLEM };
}

function asKind(value: string): AssetKindKey | null {
  return ASSET_KIND_LABELS.find((k) => k.kind === value)?.kind ?? null;
}

async function readCards(
  projectId: string,
  userId: string,
  kind: AssetKindKey,
  cursor: string | null,
  want: number,
): Promise<CardsPage | null> {
  const overview = await getPreProductionOverview(projectId, userId);
  if (!overview) return null;
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
  const counts = overview.kinds.find((k) => k.kind === kind);
  return { items, nextCursor: next, total: counts?.total ?? 0, ready: counts?.ready ?? 0 };
}

/** The next page of a category. */
export async function loadCardsAction(
  projectId: string,
  kind: string,
  cursor: string,
): Promise<ActionResult<CardsPage>> {
  const user = await requireUser();
  const key = asKind(kind);
  if (!key) return { ok: false, error: "This kind of asset does not exist." };
  try {
    const page = await readCards(projectId, user.id, key, cursor, 24);
    return page ? { ok: true, data: page } : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

/** The first `count` assets again, for polling. */
export async function refreshCardsAction(
  projectId: string,
  kind: string,
  count: number,
): Promise<ActionResult<CardsPage>> {
  const user = await requireUser();
  const key = asKind(kind);
  if (!key) return { ok: false, error: "This kind of asset does not exist." };
  try {
    const page = await readCards(projectId, user.id, key, null, Math.max(24, Math.min(count, 500)));
    return page ? { ok: true, data: page } : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export async function addAssetAction(
  projectId: string,
  kind: string,
  input: { name: string; description: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const key = asKind(kind);
  if (!key) return { ok: false, error: "This kind of asset does not exist." };
  try {
    const created = await addAsset({
      projectId,
      userId: user.id,
      kind: key,
      name: input.name,
      description: input.description.trim() || undefined,
    });
    if (!created) return { ok: false, error: MISSING };
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

export async function mergeAssetsAction(
  projectId: string,
  keepId: string,
  mergeId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const kept = await mergeAssets({ keepId, mergeId, userId: user.id });
    if (!kept) return { ok: false, error: "One of these assets no longer exists." };
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}
