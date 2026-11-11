"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { getProjectForUser, ProjectInputError, saveStyle } from "@/server/projects";
import { confirmUpload, createUpload, StorageError } from "@/server/storage";

export type SaveStyleResult = { ok: true } | { ok: false; error: string };
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const MISSING = "This project no longer exists. It may have been archived.";
const SERVER_PROBLEM = "The server had a problem. Try again in a moment.";

/** "Not what you have in mind?": names, reference images and a description, any mix. */
export interface StyleReferenceInput {
  titles: string[];
  description?: string;
  fileIds: string[];
}

/** The answers of the Style screen, as the form sends them. Validated again by the service. */
export interface StyleInput {
  visualStyle: string;
  genre: string;
  format: "movie" | "series";
  orientation: "landscape" | "portrait";
  totalDurationSeconds: number;
  episodeDurationSeconds?: number;
  references?: { visualStyle?: StyleReferenceInput; genre?: StyleReferenceInput };
}

export async function saveStyleAction(
  projectId: string,
  style: StyleInput,
): Promise<SaveStyleResult> {
  const user = await requireUser();
  try {
    const saved = await saveStyle({ projectId, userId: user.id, style });
    if (!saved) return { ok: false, error: MISSING };
    // The stage may have moved on, so the sidebar and the toolbar need fresh data.
    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ProjectInputError) return { ok: false, error: error.message };
    return { ok: false, error: SERVER_PROBLEM };
  }
}

export interface UploadTicketData {
  fileId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

/** Records a reference image and returns where the browser sends its bytes (straight to storage). */
export async function createStyleReferenceUploadAction(
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
      purpose: "style_reference",
    });
    return {
      ok: true,
      data: { fileId: ticket.fileId, uploadUrl: ticket.uploadUrl, headers: ticket.headers },
    };
  } catch (error) {
    if (error instanceof StorageError && error.code === "invalid_file") {
      return { ok: false, error: "Choose a .png, .jpg or .webp image up to 15 MB." };
    }
    console.error("[style actions]", error);
    return { ok: false, error: SERVER_PROBLEM };
  }
}

/** Checks the uploaded bytes against what was declared and marks the image ready. */
export async function finishStyleReferenceUploadAction(fileId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await confirmUpload({ fileId, ownerId: user.id });
    return { ok: true, data: null };
  } catch (error) {
    if (error instanceof StorageError) {
      return { ok: false, error: "The upload did not complete. Add the image again." };
    }
    console.error("[style actions]", error);
    return { ok: false, error: SERVER_PROBLEM };
  }
}
