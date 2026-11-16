"use server";

import { revalidatePath } from "next/cache";
import {
  addAsset,
  getAssetDetail,
  includeSkippedAsset,
  mergeAssets,
  removeAsset,
  skipDetectedAssets,
  submitDetectionReview,
  submitSheetReview,
  updateAsset,
} from "@/server/assets";
import { isUuid, userAction, type ActionResult } from "../../../../_lib/action";
import {
  asKind,
  CARD_PAGE,
  CARDS_MISSING_RESULT,
  NO_SUCH_KIND,
  readCards,
  type CardsPage,
} from "./_lib/read-cards";

export type { CardsPage };

const MISSING_RESULT = CARDS_MISSING_RESULT;
const GONE = { ok: false, error: "This asset no longer exists." } as const;
const PAGE = CARD_PAGE;

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
 * One review round of the detected list, in the user's own words: the correction starts in the
 * background. `rescan` runs the whole script again instead (no words needed).
 */
export async function submitDetectionReviewAction(
  projectId: string,
  input: { note?: string; rescan?: boolean },
): Promise<ActionResult<{ started: boolean }>> {
  return userAction("expensive", "category.submitDetectionReview", async (user) => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const result = await submitDetectionReview({ projectId, userId: user.id, ...input });
    if (!result) return MISSING_RESULT;
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: result };
  });
}

/** "Not needed as its own asset": the assets are skipped at once (no dami). */
export async function skipAssetsAction(
  projectId: string,
  refs: string[],
): Promise<ActionResult<{ skipped: number }>> {
  return userAction("mutate", "category.skipAssets", async (user) => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const result = await skipDetectedAssets({ projectId, userId: user.id, refs });
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
