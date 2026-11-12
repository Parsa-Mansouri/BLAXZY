"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
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
import type { FixSelection } from "@/server/damis";
import { ASSET_KIND_LABELS, type AssetKindKey } from "../../_lib/asset-kinds";
import { toReviewSheet, type ReviewSheet } from "./_lib/review-sheet";

export type { ReviewSheet };

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

export interface NotReadyAsset {
  id: string;
  name: string;
  kind: AssetKindKey;
  stage: AssetStage;
}

export type ContinueResult = { ok: true } | { ok: false; error: string; notReady: NotReadyAsset[] };

const SERVER_PROBLEM = "The server had a problem. Try again in a moment.";
/** Most assets the pass or the not-ready list reads. */
const MAX_ASSETS = 500;

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof AssetInputError) return { ok: false, error: error.message };
  console.error("[review actions]", error);
  return { ok: false, error: SERVER_PROBLEM };
}

/**
 * The sheet of an asset: the accepted one of a ready asset, or the one in review. Null data when
 * the asset has neither (a sheet is being built again, or it went back a step).
 */
export async function loadReviewSheetAction(
  assetId: string,
): Promise<ActionResult<ReviewSheet | null>> {
  const user = await requireUser();
  try {
    const detail = await getAssetDetail(assetId, user.id);
    if (!detail) return { ok: false, error: "This asset no longer exists." };
    return { ok: true, data: toReviewSheet(detail, packKindOf(detail.asset.kind)) };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Sends a sheet (accepted or in review) back for changes: a character sheet with the catalog's
 * picks (a new sheet is built), or any sheet back to its design step with the design route.
 */
export async function requestSheetChangesAction(
  projectId: string,
  sheetId: string,
  input: { selections: FixSelection[]; note: string },
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const stage = await submitSheetReview({
      sheetId,
      userId: user.id,
      decision: "rejected",
      selections: input.selections,
      note: input.note || undefined,
    });
    if (!stage) return { ok: false, error: "This asset no longer exists." };
    revalidatePath(`/projects/${projectId}/pre-production`, "layout");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
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
  const user = await requireUser();
  try {
    const done = await completePreProduction({ projectId, userId: user.id });
    if (!done) {
      return {
        ok: false,
        error: "Pre-production cannot be finished from here.",
        notReady: [],
      };
    }
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    const result = failure(error);
    const notReady = error instanceof AssetInputError ? await findNotReady(projectId, user.id) : [];
    return { ...result, notReady };
  }
}
