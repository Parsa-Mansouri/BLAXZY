"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import {
  completeProduction,
  getBlockDetail,
  ProductionInputError,
  retryTake,
  submitTakeReview,
} from "@/server/production";
import {
  readBoard,
  findNextToReview,
  BOARD_PAGE_SIZE,
  type BoardPage,
  type ShotRef,
} from "./_lib/clip-data";
import { detailKey } from "./_lib/clip-view";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const MISSING = "This shot is no longer available. Go back to the clips and reload.";
const PROJECT_MISSING = "This project no longer exists. It may have been archived.";
const SERVER_PROBLEM = "The server had a problem. Try again in a moment.";

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof ProductionInputError) return { ok: false, error: error.message };
  console.error("[clip actions]", error);
  return { ok: false, error: SERVER_PROBLEM };
}

/** The sidebar shows the credit balance, so a change refreshes the whole project. */
function refreshProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

/** The next page of the board. */
export async function loadBoardAction(
  projectId: string,
  cursor: string,
): Promise<ActionResult<BoardPage>> {
  const user = await requireUser();
  try {
    const page = await readBoard(projectId, user.id, cursor, BOARD_PAGE_SIZE);
    return page ? { ok: true, data: page } : { ok: false, error: PROJECT_MISSING };
  } catch (error) {
    return failure(error);
  }
}

/** The first `count` tiles again with the status line's counts, for polling. */
export async function refreshBoardAction(
  projectId: string,
  count: number,
): Promise<ActionResult<BoardPage>> {
  const user = await requireUser();
  try {
    const want = Math.max(BOARD_PAGE_SIZE, Number.isFinite(count) ? Math.floor(count) : 0);
    const page = await readBoard(projectId, user.id, null, want);
    return page ? { ok: true, data: page } : { ok: false, error: PROJECT_MISSING };
  } catch (error) {
    return failure(error);
  }
}

/** Moves the project to done once every shot is final. */
export async function finishProductionAction(projectId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await completeProduction({ projectId, userId: user.id });
    refreshProject(projectId);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

/** A fingerprint of the shot's state, polled by the clip page. */
export async function pollClipAction(lineageId: string): Promise<string | null> {
  const user = await requireUser();
  try {
    const detail = await getBlockDetail(lineageId, user.id);
    return detail ? detailKey(detail) : null;
  } catch (error) {
    if (error instanceof ProductionInputError) return null;
    throw error;
  }
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
  const user = await requireUser();
  try {
    const stage = await submitTakeReview({ takeId, userId: user.id, ...review });
    if (!stage) return { ok: false, error: MISSING };
    refreshProject(projectId);
    const next = await findNextToReview(projectId, user.id, shot.orderIndex, shot.lineageId).catch(
      (error: unknown) => {
        console.error("[clip actions] next shot", error);
        return null;
      },
    );
    return { ok: true, data: { next } };
  } catch (error) {
    return failure(error);
  }
}

export async function retryTakeAction(projectId: string, takeId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const stage = await retryTake({ takeId, userId: user.id });
    if (!stage) return { ok: false, error: MISSING };
    refreshProject(projectId);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}
