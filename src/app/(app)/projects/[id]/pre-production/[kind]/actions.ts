"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import {
  addAsset,
  AssetInputError,
  getAssetDetail,
  getDetectionPanel,
  includeSkippedAsset,
  listAssetCards,
  mergeAssets,
  MAX_CARD_PAGE_SIZE,
  removeAsset,
  submitDetectionReview,
  submitSheetReview,
  updateAsset,
  type DetectionPanel,
} from "@/server/assets";
import type { FixSelection } from "@/server/damis";
import { ASSET_KIND_LABELS, type AssetKindKey } from "../../_lib/asset-kinds";
import { toGalleryItem, type GalleryItem } from "../_components/gallery-item";
import { countKindStages } from "../_lib/load-categories";
import type { StageCounts } from "../_lib/status-words";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

export interface CardsPage {
  items: GalleryItem[];
  nextCursor: string | null;
  /** How many assets of the kind are at each stage (all of them, not only this page). */
  counts: StageCounts;
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

/**
 * Accepts the sheet waiting for review on an asset, straight from its card. The card only knows
 * the asset, so the sheet in review is looked up here.
 */
export async function acceptSheetAction(projectId: string, assetId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const detail = await getAssetDetail(assetId, user.id);
    if (!detail || detail.asset.projectId !== projectId) {
      return { ok: false, error: "This asset no longer exists." };
    }
    const sheet = detail.sheets[0];
    if (detail.stage !== "sheet_review" || !sheet || sheet.status !== "in_review") {
      return { ok: false, error: "This sheet was already reviewed. Open the asset to see it." };
    }
    const stage = await submitSheetReview({
      sheetId: sheet.id,
      userId: user.id,
      decision: "accepted",
    });
    if (!stage) return { ok: false, error: "This asset no longer exists." };
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, data: null };
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

/** What the category screens show about the detected list ("Something wrong with this list?"). */
export async function detectionPanelAction(
  projectId: string,
): Promise<ActionResult<DetectionPanel>> {
  const user = await requireUser();
  try {
    const panel = await getDetectionPanel(projectId, user.id);
    return panel ? { ok: true, data: panel } : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

/**
 * One review round of the detected list: skips apply at once, corrections and re-scans start in
 * the background.
 */
export async function submitDetectionReviewAction(
  projectId: string,
  selections: FixSelection[],
  note?: string,
): Promise<ActionResult<{ skipped: number; started: boolean }>> {
  const user = await requireUser();
  try {
    const result = await submitDetectionReview({ projectId, userId: user.id, selections, note });
    if (!result) return { ok: false, error: MISSING };
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error);
  }
}

/** Renames an asset (its old name is kept as an alias). */
export async function renameAssetAction(
  projectId: string,
  assetId: string,
  name: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const updated = await updateAsset({ assetId, userId: user.id, name });
    if (!updated) return { ok: false, error: "This asset no longer exists." };
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

/** Removes an asset from Pre-production (its images and sheets are kept). */
export async function removeAssetAction(projectId: string, assetId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const removed = await removeAsset({ assetId, userId: user.id });
    if (!removed) return { ok: false, error: "This asset no longer exists." };
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

/** Includes a skipped asset again (it will be designed). */
export async function includeAssetAction(
  projectId: string,
  assetId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const included = await includeSkippedAsset({ assetId, userId: user.id });
    if (!included) return { ok: false, error: "This asset no longer exists." };
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}
