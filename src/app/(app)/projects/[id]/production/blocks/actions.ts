"use server";

import { revalidatePath } from "next/cache";
import { listAssetCards } from "@/server/assets";
import {
  approveAllBlocks,
  getBlockDetail,
  PriceChangedError,
  quoteProduction,
  requestNextShotUpdate,
  retryPreparation,
  setBlockAssets,
  startDrafts,
  submitBlockReview,
} from "@/server/production";
import { clampCount, isUuid, userAction, type ActionResult } from "../../../../_lib/action";
import { ASSET_KIND_LABELS } from "../../_lib/asset-kinds";
import { blockHref } from "../../_lib/production-routes";
import { readSnapshot, SHOTS_MISSING, SHOT_PAGE, type BlocksSnapshot } from "./_lib/read-snapshot";
import { nextToReviewHref } from "./_lib/navigation";

export type { BlocksSnapshot };

export interface PickerAsset {
  id: string;
  name: string;
  kind: string;
  thumbnailFileId: string | null;
}

export interface Quote {
  count: number;
  credits: number;
  finalsEach: number;
  balance: number;
}

const MISSING = SHOTS_MISSING;
const MISSING_RESULT = { ok: false, error: MISSING } as const;
const PROJECT_GONE = { ok: false, error: "This project is no longer available." } as const;
const PAGE = SHOT_PAGE;

/** Starting the drafts shows in Production's screens; the sidebar's balance refreshes itself. */
function refreshProduction(projectId: string) {
  revalidatePath(`/projects/${projectId}/production`, "layout");
}

/** The next page of shots. */
export async function loadBlocksAction(
  projectId: string,
  cursor: string,
): Promise<ActionResult<BlocksSnapshot>> {
  return userAction("read", "blocks.load", async (user) => {
    const snapshot = await readSnapshot(projectId, user.id, cursor, PAGE);
    return snapshot ? { ok: true, data: snapshot } : MISSING_RESULT;
  });
}

export async function approveAllAction(
  projectId: string,
  loaded: number,
): Promise<ActionResult<BlocksSnapshot>> {
  return userAction("mutate", "blocks.approveAll", async (user) => {
    await approveAllBlocks({ projectId, userId: user.id });
    const snapshot = await readSnapshot(projectId, user.id, null, clampCount(loaded, PAGE, 500));
    return snapshot ? { ok: true, data: snapshot } : MISSING_RESULT;
  });
}

export async function quoteAction(projectId: string): Promise<ActionResult<Quote>> {
  return userAction("read", "blocks.quote", async (user) => {
    const quote = await quoteProduction(projectId, user.id);
    if (!quote) return PROJECT_GONE;
    return {
      ok: true,
      data: {
        count: quote.drafts.count,
        credits: quote.drafts.credits,
        finalsEach: quote.finalsEach,
        balance: quote.balance,
      },
    };
  });
}

export type StartResult =
  { ok: true; data: null } | { ok: false; error: string; priceChanged?: boolean };

export async function startDraftsAction(
  projectId: string,
  expectedCredits: number,
): Promise<StartResult> {
  return userAction("expensive", "blocks.startDrafts", async (user): Promise<StartResult> => {
    if (!isUuid(projectId)) return PROJECT_GONE;
    try {
      await startDrafts({ projectId, userId: user.id, expectedCredits });
    } catch (error) {
      if (error instanceof PriceChangedError) {
        return { ok: false, error: error.message, priceChanged: true };
      }
      throw error;
    }
    refreshProduction(projectId);
    return { ok: true, data: null };
  });
}

export async function retryPreparationAction(
  projectId: string,
  lineageId: string,
): Promise<ActionResult> {
  return userAction("expensive", "blocks.retryPreparation", async (user) => {
    if (!isUuid(projectId) || !isUuid(lineageId)) return MISSING_RESULT;
    const stage = await retryPreparation({ lineageId, userId: user.id });
    if (!stage) return MISSING_RESULT;
    revalidatePath(blockHref(projectId, lineageId));
    return { ok: true, data: null };
  });
}

export async function setAssetsAction(
  projectId: string,
  lineageId: string,
  assetIds: string[],
): Promise<ActionResult> {
  return userAction("mutate", "blocks.setAssets", async (user) => {
    if (!isUuid(projectId) || !isUuid(lineageId)) return MISSING_RESULT;
    const block = await setBlockAssets({ lineageId, userId: user.id, assetIds });
    if (!block) return MISSING_RESULT;
    revalidatePath(blockHref(projectId, lineageId));
    return { ok: true, data: null };
  });
}

export interface ReviewOutcome {
  /** Where to go next: the next shot waiting for review, or the list. */
  nextHref: string;
}

export async function reviewBlockAction(
  projectId: string,
  lineageId: string,
  review: { decision: "accepted" | "rejected"; note?: string; regenerate?: boolean },
): Promise<ActionResult<ReviewOutcome>> {
  return userAction("expensive", "blocks.review", async (user) => {
    if (!isUuid(projectId) || !isUuid(lineageId)) return MISSING_RESULT;
    const before = await getBlockDetail(lineageId, user.id);
    if (!before) return MISSING_RESULT;
    const stage = await submitBlockReview({ lineageId, userId: user.id, ...review });
    if (!stage) return MISSING_RESULT;
    revalidatePath(blockHref(projectId, lineageId));
    const nextHref =
      review.decision === "accepted"
        ? await nextToReviewHref(projectId, user.id, before.orderIndex, lineageId)
        : blockHref(projectId, lineageId);
    return { ok: true, data: { nextHref } };
  });
}

/** Revises the shot after this one so it opens from the new ending of this shot. */
export async function updateNextShotAction(
  projectId: string,
  lineageId: string,
): Promise<ActionResult<{ nextHref: string }>> {
  return userAction("expensive", "blocks.updateNextShot", async (user) => {
    if (!isUuid(projectId) || !isUuid(lineageId)) return MISSING_RESULT;
    const nextLineageId = await requestNextShotUpdate({ lineageId, userId: user.id });
    if (!nextLineageId) return MISSING_RESULT;
    revalidatePath(blockHref(projectId, lineageId));
    revalidatePath(blockHref(projectId, nextLineageId));
    return { ok: true, data: { nextHref: blockHref(projectId, nextLineageId) } };
  });
}

const PICKER_PAGE = 30;
const KIND_LIST = ASSET_KIND_LABELS.map((k) => k.kind).filter((kind) => kind !== "voice");

/**
 * Ready image assets of the project for the picker, kind by kind. The cursor is `<kind
 * index>:<cursor of that kind>`; an empty cursor starts at the first kind.
 */
export async function loadPickerAssetsAction(
  projectId: string,
  cursor: string | null,
): Promise<ActionResult<{ items: PickerAsset[]; nextCursor: string | null }>> {
  return userAction("read", "blocks.loadPickerAssets", async (user) => {
    let kindIndex = 0;
    let inner: string | null = null;
    if (cursor) {
      const [index, rest] = cursor.split(":", 2);
      kindIndex = Number(index);
      inner = rest || null;
      if (!Number.isInteger(kindIndex) || kindIndex < 0) kindIndex = 0;
    }
    const items: PickerAsset[] = [];
    while (kindIndex < KIND_LIST.length && items.length < PICKER_PAGE) {
      const kind = KIND_LIST[kindIndex];
      const page = await listAssetCards(projectId, user.id, { kind, cursor: inner, limit: 50 });
      if (!page) return PROJECT_GONE;
      for (const card of page.items) {
        if (card.stage !== "ready") continue;
        items.push({
          id: card.asset.id,
          name: card.asset.name,
          kind: card.asset.kind,
          thumbnailFileId: card.thumbnailFileId,
        });
      }
      if (page.nextCursor) inner = page.nextCursor;
      else {
        kindIndex++;
        inner = null;
      }
    }
    const nextCursor = kindIndex < KIND_LIST.length ? `${kindIndex}:${inner ?? ""}` : null;
    return { ok: true, data: { items, nextCursor } };
  });
}
