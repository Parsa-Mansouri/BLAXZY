"use server";

import {
  getClipDownloadUrl,
  getExport,
  listFinishedClips,
  MAX_CLIP_PAGE_SIZE,
  requestExport,
  type ExportView,
  type FinishedClip,
} from "@/server/production";
import { pollAction, pollFailure, userAction, type ActionResult } from "../../../../_lib/action";

const MISSING = "This film is no longer available. Reload the page.";
const PAGE = 24;

export type { ExportView, FinishedClip };

/** The next page of clips, in story order. */
export async function loadClipsAction(
  projectId: string,
  cursor: string,
): Promise<ActionResult<{ items: FinishedClip[]; nextCursor: string | null }>> {
  return userAction("read", "finished.loadClips", async (user) => {
    const page = await listFinishedClips(projectId, user.id, {
      cursor,
      limit: Math.min(PAGE, MAX_CLIP_PAGE_SIZE),
    });
    return page ? { ok: true, data: page } : { ok: false, error: MISSING };
  });
}

/** A link that saves one clip under its file name. */
export async function clipDownloadAction(lineageId: string): Promise<ActionResult<string>> {
  return userAction("read", "finished.clipDownload", async (user) => {
    const url = await getClipDownloadUrl({ lineageId, userId: user.id });
    return url ? { ok: true, data: url } : { ok: false, error: "This clip is not available." };
  });
}

/** Starts the ZIP of every clip, or returns the ready one. */
export async function requestExportAction(projectId: string): Promise<ActionResult<ExportView>> {
  return userAction("expensive", "finished.requestExport", async (user) => {
    const view = await requestExport({ projectId, userId: user.id });
    return view ? { ok: true, data: view } : { ok: false, error: MISSING };
  });
}

export async function pollExportAction(exportId: string): Promise<ActionResult<ExportView>> {
  return pollAction("finished.pollExport", pollFailure, async (user) => {
    const view = await getExport(exportId, user.id);
    return view ? { ok: true, data: view } : { ok: false, error: MISSING };
  });
}
