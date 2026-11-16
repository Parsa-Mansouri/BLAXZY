"use server";

import { revalidatePath } from "next/cache";
import {
  AssetInputError,
  completePreProduction,
  getAssetDetail,
  getPreProductionOverview,
  listAssetCards,
  MAX_CARD_PAGE_SIZE,
  packKindOf,
  submitSheetReview,
  type AssetStage,
} from "@/server/assets";
import { isUuid, userAction, type ActionResult } from "../../../../_lib/action";
import { ASSET_KIND_LABELS, type AssetKindKey } from "../../_lib/asset-kinds";
import { toReviewSheet, type ReviewSheet } from "./_lib/review-sheet";

export type { ReviewSheet };

export interface NotReadyAsset {
  id: string;
  name: string;
  kind: AssetKindKey;
  stage: AssetStage;
}

export type ContinueResult = { ok: true } | { ok: false; error: string; notReady: NotReadyAsset[] };

const GONE = { ok: false, error: "This asset no longer exists." } as const;
/** Most assets the pass or the not-ready list reads. */
const MAX_ASSETS = 500;

/**
 * The sheet of an asset: the accepted one of a ready asset, or the one in review. Null data when
 * the asset has neither (a sheet is being built again, or it went back a step).
 */
export async function loadReviewSheetAction(
  assetId: string,
): Promise<ActionResult<ReviewSheet | null>> {
  return userAction("read", "review.loadSheet", async (user) => {
    const detail = await getAssetDetail(assetId, user.id);
    if (!detail) return GONE;
    return { ok: true, data: toReviewSheet(detail, packKindOf(detail.asset.kind)) };
  });
}

/**
 * Sends a sheet (accepted or in review) back for changes: a character sheet with the user's words
 * (a new sheet is built) or drawn again, or any sheet back to its design step (`designChange`).
 */
export async function requestSheetChangesAction(
  projectId: string,
  sheetId: string,
  input: { note: string; regenerate?: boolean; designChange?: boolean },
  expectedCredits?: number,
): Promise<ActionResult> {
  return userAction("expensive", "review.requestSheetChanges", async (user) => {
    if (!isUuid(projectId)) return GONE;
    const stage = await submitSheetReview({
      sheetId,
      userId: user.id,
      decision: "rejected",
      note: input.note || undefined,
      regenerate: input.regenerate,
      designChange: input.designChange,
      expectedCredits,
    });
    if (!stage) return GONE;
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: null };
  });
}

async function findNotReady(projectId: string, userId: string): Promise<NotReadyAsset[]> {
  const overview = await getPreProductionOverview(projectId, userId);
  if (!overview) return [];
  const found: NotReadyAsset[] = [];
  for (const { kind } of ASSET_KIND_LABELS) {
    const total = overview.kinds.find((k) => k.kind === kind);
    if (!total || total.ready === total.total) continue;
    let cursor: string | null = null;
    do {
      const page = await listAssetCards(projectId, userId, {
        kind,
        cursor,
        limit: MAX_CARD_PAGE_SIZE,
      });
      if (!page) break;
      for (const card of page.items) {
        if (card.stage !== "ready") {
          found.push({ id: card.asset.id, name: card.asset.name, kind, stage: card.stage });
        }
      }
      cursor = page.nextCursor;
    } while (cursor && found.length < MAX_ASSETS);
  }
  return found;
}

/** Finishes Pre-production. When an asset is no longer ready, says which. */
export async function continueToProductionAction(projectId: string): Promise<ContinueResult> {
  const result = await userAction(
    "expensive",
    "review.continueToProduction",
    async (user): Promise<ContinueResult> => {
      const cannot: ContinueResult = {
        ok: false,
        error: "Pre-production cannot be finished from here.",
        notReady: [],
      };
      if (!isUuid(projectId)) return cannot;
      try {
        const done = await completePreProduction({ projectId, userId: user.id });
        if (!done) return cannot;
      } catch (error) {
        // An asset is no longer ready: say which ones.
        if (error instanceof AssetInputError) {
          return {
            ok: false,
            error: error.message,
            notReady: await findNotReady(projectId, user.id),
          };
        }
        throw error;
      }
      revalidatePath(`/projects/${projectId}`, "layout");
      return { ok: true };
    },
  );
  return result.ok || "notReady" in result ? result : { ...result, notReady: [] };
}
