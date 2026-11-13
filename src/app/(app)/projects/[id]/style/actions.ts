"use server";

import { revalidatePath } from "next/cache";
import { getProjectForUser, saveStyle } from "@/server/projects";
import { confirmUpload } from "@/server/storage";
import { isUuid, userAction, type ActionResult } from "../../../_lib/action";
import {
  issueUploadTicket,
  uploadIncomplete,
  type UploadTicketData,
} from "../../../_lib/upload-ticket";

export type SaveStyleResult = { ok: true } | { ok: false; error: string };

const MISSING = "This project no longer exists. It may have been archived.";

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
  return userAction("mutate", "style.save", async (user): Promise<SaveStyleResult> => {
    if (!isUuid(projectId)) return { ok: false, error: MISSING };
    const saved = await saveStyle({ projectId, userId: user.id, style });
    if (!saved) return { ok: false, error: MISSING };
    // The stage may have moved on, so the sidebar and the toolbar need fresh data.
    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/dashboard");
    return { ok: true };
  });
}

/** Records a reference image and returns where the browser sends its bytes (straight to storage). */
export async function createStyleReferenceUploadAction(
  projectId: string,
  file: { name: string; type: string; size: number },
): Promise<ActionResult<UploadTicketData>> {
  return userAction("upload", "style.createReferenceUpload", async (user) => {
    if (!isUuid(projectId)) return { ok: false, error: MISSING };
    if (!(await getProjectForUser(projectId, user.id))) return { ok: false, error: MISSING };
    return issueUploadTicket(
      {
        ownerId: user.id,
        projectId,
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        purpose: "style_reference",
      },
      "Choose a .png, .jpg or .webp image up to 15 MB.",
    );
  });
}

/** Checks the uploaded bytes against what was declared and marks the image ready. */
export async function finishStyleReferenceUploadAction(fileId: string): Promise<ActionResult> {
  return userAction(
    "mutate",
    "style.finishReferenceUpload",
    async (user): Promise<ActionResult> => {
      await confirmUpload({ fileId, ownerId: user.id });
      return { ok: true, data: null };
    },
    { mapError: uploadIncomplete("The upload did not complete. Add the image again.") },
  );
}
