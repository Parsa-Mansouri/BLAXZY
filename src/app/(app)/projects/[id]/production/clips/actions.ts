"use server";

import { revalidatePath } from "next/cache";
import {
  completeProduction,
  getBlockDetail,
  retryTake,
  submitTakeReview,
} from "@/server/production";
import {
  clampCount,
  isUuid,
  logActionError,
  pollAction,
  pollFailure,
  pollNull,
  userAction,
  type ActionResult,
} from "../../../../_lib/action";
import {
  readBoard,
  findNextToReview,
  BOARD_PAGE_SIZE,
  type BoardPage,
  type ShotRef,
} from "./_lib/clip-data";
import { detailKey } from "./_lib/clip-view";

const MISSING = "This shot is no longer available. Go back to the clips and reload.";
const MISSING_RESULT = { ok: false, error: MISSING } as const;
const PROJECT_MISSING = "This project no longer exists. It may have been archived.";
const PROJECT_MISSING_RESULT = { ok: false, error: PROJECT_MISSING } as const;

/** Finishing the film changes the stage shown around every page of the project. */
function refreshProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

/** A clip decision shows in Production's screens; the sidebar's balance refreshes itself. */
function refreshProduction(projectId: string) {
  revalidatePath(`/projects/${projectId}/production`, "layout");
}

/** The next page of the board. */
export async function loadBoardAction(
  projectId: string,
  cursor: string,
): Promise<ActionResult<BoardPage>> {
  return userAction("read", "clips.loadBoard", async (user) => {
    const page = await readBoard(projectId, user.id, cursor, BOARD_PAGE_SIZE);
    return page ? { ok: true, data: page } : PROJECT_MISSING_RESULT;
  });
}

/** The first `count` tiles again with the status line's counts, for polling (never redirects). */
export async function refreshBoardAction(
  projectId: string,
  count: number,
): Promise<ActionResult<BoardPage>> {
  return pollAction("clips.refreshBoard", pollFailure, async (user) => {
    const want = clampCount(count, BOARD_PAGE_SIZE, 500);
    const page = await readBoard(projectId, user.id, null, want);
    return page ? { ok: true, data: page } : PROJECT_MISSING_RESULT;
  });
}

/** Moves the project to done once every shot is final. */
export async function finishProductionAction(projectId: string): Promise<ActionResult> {
  return userAction("mutate", "clips.finishProduction", async (user) => {
    if (!isUuid(projectId)) return PROJECT_MISSING_RESULT;
    const finished = await completeProduction({ projectId, userId: user.id });
    if (!finished) return PROJECT_MISSING_RESULT;
    refreshProject(projectId);
    return { ok: true, data: null };
  });
}

/**
 * A fingerprint of the shot's state, polled by the clip page. Null when the shot is gone, and
 * when signed out, rate limited or failing (a background poll never redirects).
 */
export async function pollClipAction(lineageId: string): Promise<string | null> {
  return pollAction("clips.poll", pollNull, async (user) => {
    const detail = await getBlockDetail(lineageId, user.id);
    return detail ? detailKey(detail) : null;
  });
}

export interface ReviewInput {
  decision: "accepted" | "rejected";
  issueCodes?: string[];
  note?: string;
}

/** Where to go after a decision: the next shot waiting for review, or null for the board. */
export interface Decided {
  next: ShotRef | null;
}

export async function reviewTakeAction(
  projectId: string,
  shot: { lineageId: string; orderIndex: number },
  takeId: string,
  review: ReviewInput,
): Promise<ActionResult<Decided>> {
  return userAction("expensive", "clips.reviewTake", async (user) => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const stage = await submitTakeReview({ takeId, userId: user.id, ...review });
    if (!stage) return MISSING_RESULT;
    refreshProduction(projectId);
    const next = await findNextToReview(projectId, user.id, shot.orderIndex, shot.lineageId).catch(
      (error: unknown) => {
        logActionError("clips.nextShot", error);
        return null;
      },
    );
    return { ok: true, data: { next } };
  });
}

export async function retryTakeAction(projectId: string, takeId: string): Promise<ActionResult> {
  return userAction("expensive", "clips.retryTake", async (user) => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const stage = await retryTake({ takeId, userId: user.id });
    if (!stage) return MISSING_RESULT;
    refreshProduction(projectId);
    return { ok: true, data: null };
  });
}
