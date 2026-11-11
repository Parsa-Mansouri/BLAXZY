"use server";

import { requireUser } from "@/server/auth";
import {
  getClipDownloadUrl,
  getExport,
  listFinishedClips,
  MAX_CLIP_PAGE_SIZE,
  ProductionInputError,
  requestExport,
  type ExportView,
  type FinishedClip,
} from "@/server/production";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const MISSING = "This film is no longer available. Reload the page.";
const SERVER_PROBLEM = "The server had a problem. Try again in a moment.";
const PAGE = 24;

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof ProductionInputError) return { ok: false, error: error.message };
  console.error("[finished actions]", error);
  return { ok: false, error: SERVER_PROBLEM };
}

export type { ExportView, FinishedClip };

/** The next page of clips, in story order. */
export async function loadClipsAction(
  projectId: string,
  cursor: string,
): Promise<ActionResult<{ items: FinishedClip[]; nextCursor: string | null }>> {
  const user = await requireUser();
  try {
    const page = await listFinishedClips(projectId, user.id, {
      cursor,
      limit: Math.min(PAGE, MAX_CLIP_PAGE_SIZE),
    });
    return page ? { ok: true, data: page } : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

/** A link that saves one clip under its file name. */
export async function clipDownloadAction(lineageId: string): Promise<ActionResult<string>> {
  const user = await requireUser();
  try {
    const url = await getClipDownloadUrl({ lineageId, userId: user.id });
    return url ? { ok: true, data: url } : { ok: false, error: "This clip is not available." };
  } catch (error) {
    return failure(error);
  }
}

/** Starts the ZIP of every clip, or returns the ready one. */
export async function requestExportAction(projectId: string): Promise<ActionResult<ExportView>> {
  const user = await requireUser();
  try {
    const view = await requestExport({ projectId, userId: user.id });
    return view ? { ok: true, data: view } : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export async function pollExportAction(exportId: string): Promise<ActionResult<ExportView>> {
  const user = await requireUser();
  try {
    const view = await getExport(exportId, user.id);
    return view ? { ok: true, data: view } : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}
