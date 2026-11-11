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
  submitSheetReview,
  type AssetStage,
} from "@/server/assets";
import { ASSET_KIND_LABELS, type AssetKindKey } from "../../_lib/asset-kinds";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/** The accepted sheet of an asset, as the pass shows it. */
export interface ReviewSheet {
  sheetId: string;
  fileId: string;
}

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

/** The accepted sheet of an asset; null data when the asset is no longer ready. */
export async function loadReviewSheetAction(
  assetId: string,
): Promise<ActionResult<ReviewSheet | null>> {
  const user = await requireUser();
  try {
    const detail = await getAssetDetail(assetId, user.id);
    if (!detail) return { ok: false, error: "This asset no longer exists." };
    const sheet =
      detail.stage === "ready" ? detail.sheets.find((s) => s.status === "accepted") : null;
    return { ok: true, data: sheet?.fileId ? { sheetId: sheet.id, fileId: sheet.fileId } : null };
  } catch (error) {
    return failure(error);
  }
}

/** Sends a ready asset's sheet back for changes: a new sheet is built from the notes. */
export async function requestSheetChangesAction(
  sheetId: string,
  input: { issueCodes: string[]; note: string },
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const stage = await submitSheetReview({
      sheetId,
      userId: user.id,
      decision: "rejected",
      issueCodes: input.issueCodes,
      note: input.note || undefined,
    });
    if (!stage) return { ok: false, error: "This asset no longer exists." };
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
