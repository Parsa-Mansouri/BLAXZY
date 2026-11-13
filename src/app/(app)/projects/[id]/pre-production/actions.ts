"use server";

import { getSectioningStatus, listBlocks } from "@/server/blocks";
import { pollAction, pollNull, userAction } from "../../../_lib/action";
import { SHOT_PAGE_SIZE, toShotRow, type ShotRow } from "./_components/shot-types";

export type ShotPage =
  { ok: true; items: ShotRow[]; nextCursor: string | null } | { ok: false; error: string };

/** The next page of the project's current shots, in story order. */
export async function loadShotsAction(projectId: string, cursor: string): Promise<ShotPage> {
  return userAction("read", "preProduction.loadShots", async (user): Promise<ShotPage> => {
    const page = await listBlocks(projectId, user.id, { limit: SHOT_PAGE_SIZE, cursor });
    if (!page) {
      return { ok: false, error: "This project no longer exists. It may have been archived." };
    }
    return { ok: true, items: page.items.map(toShotRow), nextCursor: page.nextCursor };
  });
}

/**
 * Sectioning state and block count, polled while the shots are prepared. Null when there is
 * nothing to report (the project is gone, signed out, or the poll failed).
 */
export async function pollPreProductionAction(projectId: string) {
  return pollAction("preProduction.poll", pollNull, async (user) => {
    const status = await getSectioningStatus(projectId, user.id);
    return status ? { state: status.state, blockCount: status.blockCount } : null;
  });
}
