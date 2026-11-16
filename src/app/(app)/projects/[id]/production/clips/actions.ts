"use server";

import { revalidatePath } from "next/cache";
import { completeProduction, retryTake, submitTakeReview } from "@/server/production";
import { isUuid, logActionError, userAction, type ActionResult } from "../../../../_lib/action";
import {
  readBoard,
  findNextToReview,
  BOARD_PAGE_SIZE,
  type BoardPage,
  type ShotRef,
} from "./_lib/clip-data";

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

export interface ReviewInput {
  decision: "accepted" | "rejected";
  note?: string;
  /** Rejections: findings left standing, points to keep, and notes on a part of the clip. */
  confirmedIssueIds?: string[];
  keepIds?: string[];
  timedNotes?: { fromS: number; toS: number; text: string }[];
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
  /** The price the user confirmed: needed when the decision starts a clip (see `useSpend`). */
  expectedCredits?: number,
): Promise<ActionResult<Decided>> {
  return userAction("expensive", "clips.reviewTake", async (user) => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const stage = await submitTakeReview({ takeId, userId: user.id, ...review, expectedCredits });
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

export async function retryTakeAction(
  projectId: string,
  takeId: string,
  expectedCredits?: number,
): Promise<ActionResult> {
  return userAction("expensive", "clips.retryTake", async (user) => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const stage = await retryTake({ takeId, userId: user.id, expectedCredits });
    if (!stage) return MISSING_RESULT;
    refreshProduction(projectId);
    return { ok: true, data: null };
  });
}
