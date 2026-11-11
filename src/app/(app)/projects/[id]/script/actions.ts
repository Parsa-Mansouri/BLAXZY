"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { BlocksInputError, retrySectioning } from "@/server/blocks";
import { getProjectForUser } from "@/server/projects";
import {
  editAcceptedScript,
  getScriptState,
  getScriptVersion,
  retryScriptVersion,
  ScriptInputError,
  startFromBrief,
  startFromUpload,
  submitScriptReview,
  type ScriptVersionView,
} from "@/server/script";
import { confirmUpload, createUpload, StorageError } from "@/server/storage";
import { loadBackgroundStatus, type BackgroundStatus } from "../_lib/background-status";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const MISSING = "This project no longer exists. It may have been archived.";
const SERVER_PROBLEM = "The server had a problem. Try again in a moment.";

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof ScriptInputError || error instanceof BlocksInputError) {
    return { ok: false, error: error.message };
  }
  console.error("[script actions]", error);
  return { ok: false, error: SERVER_PROBLEM };
}

/** The sidebar and toolbar show the stage, so a stage change refreshes the whole project. */
function refreshProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function startFromBriefAction(
  projectId: string,
  brief: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const version = await startFromBrief({ projectId, userId: user.id, brief });
    if (!version) return { ok: false, error: MISSING };
    refreshProject(projectId);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

export interface UploadTicketData {
  fileId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

/** Records the file and returns where the browser sends its bytes. */
export async function createScriptUploadAction(
  projectId: string,
  file: { name: string; type: string; size: number },
): Promise<ActionResult<UploadTicketData>> {
  const user = await requireUser();
  try {
    if (!(await getProjectForUser(projectId, user.id))) return { ok: false, error: MISSING };
    const ticket = await createUpload({
      ownerId: user.id,
      projectId,
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      purpose: "script_document",
    });
    return {
      ok: true,
      data: { fileId: ticket.fileId, uploadUrl: ticket.uploadUrl, headers: ticket.headers },
    };
  } catch (error) {
    if (error instanceof StorageError && error.code === "invalid_file") {
      return {
        ok: false,
        error: "This file cannot be used. Choose a .txt, .md, .docx or .pdf file up to 10 MB.",
      };
    }
    return failure(error);
  }
}

/** Checks the uploaded bytes, then starts reading the script. */
export async function finishScriptUploadAction(
  projectId: string,
  fileId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await confirmUpload({ fileId, ownerId: user.id });
    const version = await startFromUpload({ projectId, userId: user.id, fileId });
    if (!version) return { ok: false, error: MISSING };
    refreshProject(projectId);
    return { ok: true, data: null };
  } catch (error) {
    if (error instanceof StorageError) {
      return { ok: false, error: "The upload did not complete. Choose the file again." };
    }
    return failure(error);
  }
}

export interface ScriptPoll {
  versionId: string | null;
  status: ScriptVersionView["status"] | null;
}

/** The latest version and its status, for the waiting screen. */
export async function pollScriptAction(projectId: string): Promise<ScriptPoll | null> {
  const user = await requireUser();
  const state = await getScriptState(projectId, user.id);
  if (!state) return null;
  return { versionId: state.current?.id ?? null, status: state.current?.status ?? null };
}

/** One version of the project's script, read-only. */
export async function loadVersionAction(
  projectId: string,
  versionId: string,
): Promise<ActionResult<ScriptVersionView>> {
  const user = await requireUser();
  const version = await getScriptVersion(versionId, user.id);
  if (!version || !(await getProjectForUser(projectId, user.id))) {
    return { ok: false, error: "That version is not available. Reload the page." };
  }
  return { ok: true, data: version };
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
  const user = await requireUser();
  try {
    const version = await submitScriptReview({
      projectId,
      userId: user.id,
      versionId,
      decision: review.decision,
      issueCodes: review.issueCodes,
      note: review.note,
      comments: review.comments,
    });
    if (!version) return { ok: false, error: MISSING };
    refreshProject(projectId);
    if (review.decision === "accepted") revalidatePath("/dashboard");
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

export async function retryVersionAction(
  projectId: string,
  versionId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const version = await retryScriptVersion({ projectId, userId: user.id, versionId });
    if (!version) return { ok: false, error: MISSING };
    refreshProject(projectId);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

export async function editAcceptedAction(
  projectId: string,
  content: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const version = await editAcceptedScript({ projectId, userId: user.id, content });
    if (!version) return { ok: false, error: MISSING };
    refreshProject(projectId);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}

/** Where detection and sectioning stand for the accepted script. */
export async function backgroundStatusAction(
  projectId: string,
  acceptedVersionId: string | null,
): Promise<BackgroundStatus | null> {
  const user = await requireUser();
  return loadBackgroundStatus(projectId, user.id, acceptedVersionId);
}

export async function retrySectioningAction(projectId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const status = await retrySectioning({ projectId, userId: user.id });
    if (!status) return { ok: false, error: MISSING };
    return { ok: true, data: null };
  } catch (error) {
    return failure(error);
  }
}
