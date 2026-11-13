"use server";

import { revalidatePath } from "next/cache";
import { retrySectioning } from "@/server/blocks";
import { getProjectForUser } from "@/server/projects";
import {
  editAcceptedScript,
  getScriptState,
  getScriptVersion,
  approveOutline,
  retryScriptVersion,
  startFromBrief,
  startFromIdea,
  startFromUpload,
  submitScriptReview,
  type ScriptVersionView,
} from "@/server/script";
import { confirmUpload } from "@/server/storage";
import { isUuid, pollAction, pollNull, userAction, type ActionResult } from "../../../_lib/action";
import {
  issueUploadTicket,
  uploadIncomplete,
  type UploadTicketData,
} from "../../../_lib/upload-ticket";
import { loadBackgroundStatus, type BackgroundStatus } from "../_lib/background-status";

const MISSING = "This project no longer exists. It may have been archived.";
const MISSING_RESULT = { ok: false, error: MISSING } as const;

/** The sidebar and toolbar show the stage, so a stage change refreshes the whole project. */
function refreshProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function startFromBriefAction(
  projectId: string,
  brief: string,
): Promise<ActionResult> {
  return userAction("expensive", "script.startFromBrief", async (user): Promise<ActionResult> => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const version = await startFromBrief({ projectId, userId: user.id, brief });
    if (!version) return MISSING_RESULT;
    refreshProject(projectId);
    return { ok: true, data: null };
  });
}

/** Starts the Enhancer on the user's quick idea. */
export async function startFromIdeaAction(projectId: string, idea: string): Promise<ActionResult> {
  return userAction("expensive", "script.startFromIdea", async (user): Promise<ActionResult> => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const version = await startFromIdea({ projectId, userId: user.id, idea });
    if (!version) return MISSING_RESULT;
    refreshProject(projectId);
    return { ok: true, data: null };
  });
}

/** Approves a long piece's outline (with the proposed additions the user ticked). */
export async function approveOutlineAction(
  projectId: string,
  versionId: string,
  approvedAdditions: number[],
): Promise<ActionResult> {
  return userAction("expensive", "script.approveOutline", async (user): Promise<ActionResult> => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const version = await approveOutline({
      projectId,
      userId: user.id,
      versionId,
      approvedAdditions,
    });
    if (!version) return MISSING_RESULT;
    refreshProject(projectId);
    return { ok: true, data: null };
  });
}

/** Records the file and returns where the browser sends its bytes. */
export async function createScriptUploadAction(
  projectId: string,
  file: { name: string; type: string; size: number },
): Promise<ActionResult<UploadTicketData>> {
  return userAction("upload", "script.createUpload", async (user) => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    if (!(await getProjectForUser(projectId, user.id))) return MISSING_RESULT;
    return issueUploadTicket(
      {
        ownerId: user.id,
        projectId,
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        purpose: "script_document",
      },
      "This file cannot be used. Choose a .txt, .md, .docx or .pdf file up to 10 MB.",
    );
  });
}

/** Checks the uploaded bytes, then starts reading the script. */
export async function finishScriptUploadAction(
  projectId: string,
  fileId: string,
): Promise<ActionResult> {
  return userAction(
    "expensive",
    "script.finishUpload",
    async (user): Promise<ActionResult> => {
      if (!isUuid(projectId)) return MISSING_RESULT;
      await confirmUpload({ fileId, ownerId: user.id });
      const version = await startFromUpload({ projectId, userId: user.id, fileId });
      if (!version) return MISSING_RESULT;
      refreshProject(projectId);
      return { ok: true, data: null };
    },
    { mapError: uploadIncomplete("The upload did not complete. Choose the file again.") },
  );
}

export interface ScriptPoll {
  versionId: string | null;
  status: ScriptVersionView["status"] | null;
}

/**
 * The latest version and its status, for the waiting screen. Null when the project is gone, and
 * when signed out, rate limited or failing (a background poll never redirects).
 */
export async function pollScriptAction(projectId: string): Promise<ScriptPoll | null> {
  return pollAction("script.poll", pollNull, async (user) => {
    if (!isUuid(projectId)) return null;
    const state = await getScriptState(projectId, user.id);
    if (!state) return null;
    return { versionId: state.current?.id ?? null, status: state.current?.status ?? null };
  });
}

/** One version of the project's script, read-only. */
export async function loadVersionAction(
  projectId: string,
  versionId: string,
): Promise<ActionResult<ScriptVersionView>> {
  return userAction("read", "script.loadVersion", async (user) => {
    const unavailable = {
      ok: false,
      error: "That version is not available. Reload the page.",
    } as const;
    if (!isUuid(projectId) || !isUuid(versionId)) return unavailable;
    const version = await getScriptVersion(versionId, user.id);
    if (!version || !(await getProjectForUser(projectId, user.id))) return unavailable;
    return { ok: true, data: version };
  });
}

export interface ReviewInput {
  decision: "accepted" | "rejected";
  issueCodes?: string[];
  note?: string;
  comments?: { quote: string; start: number; end: number; note: string }[];
}

export async function submitReviewAction(
  projectId: string,
  versionId: string,
  review: ReviewInput,
): Promise<ActionResult> {
  return userAction("expensive", "script.submitReview", async (user): Promise<ActionResult> => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const version = await submitScriptReview({
      projectId,
      userId: user.id,
      versionId,
      decision: review.decision,
      issueCodes: review.issueCodes,
      note: review.note,
      comments: review.comments,
    });
    if (!version) return MISSING_RESULT;
    refreshProject(projectId);
    if (review.decision === "accepted") revalidatePath("/dashboard");
    return { ok: true, data: null };
  });
}

export async function retryVersionAction(
  projectId: string,
  versionId: string,
): Promise<ActionResult> {
  return userAction("expensive", "script.retryVersion", async (user): Promise<ActionResult> => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const version = await retryScriptVersion({ projectId, userId: user.id, versionId });
    if (!version) return MISSING_RESULT;
    refreshProject(projectId);
    return { ok: true, data: null };
  });
}

export async function editAcceptedAction(
  projectId: string,
  content: string,
): Promise<ActionResult> {
  return userAction("expensive", "script.editAccepted", async (user): Promise<ActionResult> => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const version = await editAcceptedScript({ projectId, userId: user.id, content });
    if (!version) return MISSING_RESULT;
    refreshProject(projectId);
    return { ok: true, data: null };
  });
}

/**
 * Where detection and sectioning stand for the accepted script. Null when the project is gone,
 * and when signed out, rate limited or failing (a background poll never redirects).
 */
export async function backgroundStatusAction(
  projectId: string,
  acceptedVersionId: string | null,
): Promise<BackgroundStatus | null> {
  return pollAction("script.backgroundStatus", pollNull, async (user) => {
    // A malformed id would reach Postgres as a failed uuid cast.
    if (!isUuid(projectId)) return null;
    if (acceptedVersionId !== null && !isUuid(acceptedVersionId)) return null;
    return loadBackgroundStatus(projectId, user.id, acceptedVersionId);
  });
}

export async function retrySectioningAction(projectId: string): Promise<ActionResult> {
  return userAction("expensive", "script.retrySectioning", async (user): Promise<ActionResult> => {
    if (!isUuid(projectId)) return MISSING_RESULT;
    const status = await retrySectioning({ projectId, userId: user.id });
    if (!status) return MISSING_RESULT;
    return { ok: true, data: null };
  });
}
