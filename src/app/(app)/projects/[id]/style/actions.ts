"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { ProjectInputError, saveStyle } from "@/server/projects";

export type SaveStyleResult = { ok: true } | { ok: false; error: string };

/** The answers of the Style screen, as the form sends them. Validated again by the service. */
export interface StyleInput {
  visualStyle: string;
  genre: string;
  format: "movie" | "series";
  orientation: "landscape" | "portrait";
  totalDurationSeconds: number;
  episodeDurationSeconds?: number;
}

export async function saveStyleAction(
  projectId: string,
  style: StyleInput,
): Promise<SaveStyleResult> {
  const user = await requireUser();
  try {
    const saved = await saveStyle({ projectId, userId: user.id, style });
    if (!saved) {
      return { ok: false, error: "This project no longer exists. It may have been archived." };
    }
    // The stage may have moved on, so the sidebar and the toolbar need fresh data.
    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ProjectInputError) return { ok: false, error: error.message };
    return { ok: false, error: "The server had a problem. Try again in a moment." };
  }
}
