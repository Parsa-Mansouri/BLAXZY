"use server";

import { requireUser } from "@/server/auth";
import { BlocksInputError, getSectioningStatus, listBlocks } from "@/server/blocks";
import { SHOT_PAGE_SIZE, toShotRow, type ShotRow } from "./_components/shot-types";

export type ShotPage =
  { ok: true; items: ShotRow[]; nextCursor: string | null } | { ok: false; error: string };

/** The next page of the project's current shots, in story order. */
export async function loadShotsAction(projectId: string, cursor: string): Promise<ShotPage> {
  const user = await requireUser();
  try {
    const page = await listBlocks(projectId, user.id, { limit: SHOT_PAGE_SIZE, cursor });
    if (!page) {
      return { ok: false, error: "This project no longer exists. It may have been archived." };
    }
    return { ok: true, items: page.items.map(toShotRow), nextCursor: page.nextCursor };
  } catch (error) {
    if (error instanceof BlocksInputError) return { ok: false, error: error.message };
    console.error("[pre-production actions]", error);
    return { ok: false, error: "The server had a problem. Try again in a moment." };
  }
}

/** Sectioning state and block count, polled while the shots are prepared. */
export async function pollPreProductionAction(projectId: string) {
  const user = await requireUser();
  const status = await getSectioningStatus(projectId, user.id);
  return status ? { state: status.state, blockCount: status.blockCount } : null;
}
