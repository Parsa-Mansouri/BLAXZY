"use server";

import { revalidatePath } from "next/cache";
import {
  addAsset,
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
} from "@/server/assets";
import type { FixSelection } from "@/server/damis";
import { toClientOptions } from "@/lib/review-option";
import {
  clampCount,
  isUuid,
  pollAction,
  pollFailure,
  userAction,
  type ActionResult,
} from "../../../../_lib/action";
import { ASSET_KIND_LABELS, type AssetKindKey } from "../../_lib/asset-kinds";
import type { ClientDetectionPanel } from "./_components/category-panel";
import { toGalleryItem, type GalleryItem } from "../_components/gallery-item";
import { countKindStages } from "../_lib/load-categories";
import type { StageCounts } from "../_lib/status-words";

export interface CardsPage {
  items: GalleryItem[];
  nextCursor: string | null;
  /** How many assets of the kind are at each stage (all of them, not only this page). */
  counts: StageCounts;
}

const MISSING = "This project no longer exists. It may have been archived.";
const MISSING_RESULT = { ok: false, error: MISSING } as const;
const GONE = { ok: false, error: "This asset no longer exists." } as const;
const NO_SUCH_KIND = { ok: false, error: "This kind of asset does not exist." } as const;
const PAGE = 24;

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
  return userAction("read", "category.loadCards", async (user) => {
    const key = asKind(kind);
    if (!key) return NO_SUCH_KIND;
    const page = await readCards(projectId, user.id, key, cursor, PAGE);
    return page ? { ok: true, data: page } : MISSING_RESULT;
  });
}

/** The first `count` assets again, for polling (never redirects; see `pollAction`). */
export async function refreshCardsAction(
  projectId: string,
  kind: string,
  count: number,
): Promise<ActionResult<CardsPage>> {
  return pollAction("category.refreshCards", pollFailure, async (user) => {
    const key = asKind(kind);
    if (!key) return NO_SUCH_KIND;
    const page = await readCards(projectId, user.id, key, null, clampCount(count, PAGE, 500));
    return page ? { ok: true, data: page } : MISSING_RESULT;
  });
}

/**
 * Accepts the sheet waiting for review on an asset, straight from its card. The card only knows
 * the asset, so the sheet in review is looked up here.
 */
export async function acceptSheetAction(projectId: string, assetId: string): Promise<ActionResult> {
  return userAction("expensive", "category.acceptSheet", async (user) => {
    const detail = await getAssetDetail(assetId, user.id);
    if (!detail || detail.asset.projectId !== projectId) return GONE;
    const sheet = detail.sheets[0];
    if (detail.stage !== "sheet_review" || !sheet || sheet.status !== "in_review") {
      return { ok: false, error: "This sheet was already reviewed. Open the asset to see it." };
    }
    const stage = await submitSheetReview({
      sheetId: sheet.id,
      userId: user.id,
      decision: "accepted",
    });
    if (!stage) return GONE;
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, data: null };
  });
}

export async function addAssetAction(
  projectId: string,
  kind: string,
  input: { name: string; description: string },
): Promise<ActionResult<{ name: string }>> {
  return userAction("mutate", "category.addAsset", async (user) => {
    const key = asKind(kind);
    if (!key) return NO_SUCH_KIND;
    if (!isUuid(projectId)) return MISSING_RESULT;
    const created = await addAsset({
      projectId,
      userId: user.id,
      kind: key,
      name: input.name,
      description: input.description.trim() || undefined,
    });
    if (!created) return MISSING_RESULT;
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: { name: created.name } };
  });
}

export async function mergeAssetsAction(
  projectId: string,
  keepId: string,
  mergeId: string,
): Promise<ActionResult> {
  return userAction("mutate", "category.mergeAssets", async (user) => {
    const gone = { ok: false, error: "One of these assets no longer exists." } as const;
    if (!isUuid(projectId)) return gone;
    const kept = await mergeAssets({ keepId, mergeId, userId: user.id });
    if (!kept) return gone;
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: null };
  });
}

/**
 * What the category screens show about the detected list ("Something wrong with this list?"). The
 * options are projected to the client-safe shape: the fix instructions sent to the model stay on
 * the server.
 */
export async function detectionPanelAction(
  projectId: string,
): Promise<ActionResult<ClientDetectionPanel>> {
  return userAction("read", "category.detectionPanel", async (user) => {
    const panel = await getDetectionPanel(projectId, user.id);
    if (!panel) return MISSING_RESULT;
    return { ok: true, data: { ...panel, options: toClientOptions(panel.options) } };
  });
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
  return userAction("expensive", "category.submitDetectionReview", async (user) => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const result = await submitDetectionReview({ projectId, userId: user.id, selections, note });
    if (!result) return MISSING_RESULT;
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: result };
  });
}

/** Renames an asset (its old name is kept as an alias). */
export async function renameAssetAction(
  projectId: string,
  assetId: string,
  name: string,
): Promise<ActionResult> {
  return userAction("mutate", "category.renameAsset", async (user) => {
    if (!isUuid(projectId)) return GONE;
    const updated = await updateAsset({ assetId, userId: user.id, name });
    if (!updated) return GONE;
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: null };
  });
}

/** Removes an asset from Pre-production (its images and sheets are kept). */
export async function removeAssetAction(projectId: string, assetId: string): Promise<ActionResult> {
  return userAction("mutate", "category.removeAsset", async (user) => {
    if (!isUuid(projectId)) return GONE;
    const removed = await removeAsset({ assetId, userId: user.id });
    if (!removed) return GONE;
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: null };
  });
}

/** Includes a skipped asset again (it will be designed). */
export async function includeAssetAction(
  projectId: string,
  assetId: string,
): Promise<ActionResult> {
  return userAction("mutate", "category.includeAsset", async (user) => {
    if (!isUuid(projectId)) return GONE;
    const included = await includeSkippedAsset({ assetId, userId: user.id });
    if (!included) return GONE;
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: null };
  });
}
