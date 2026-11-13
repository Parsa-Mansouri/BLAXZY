"use server";

import { pollAction, pollNull } from "../../../../_lib/action";
import { loadCategories } from "../_lib/load-categories";

/**
 * What the overview polls: whether work is running and a signature of what it shows. Null when
 * there is nothing to report (the project is gone, signed out, or the poll failed).
 */
export async function pollOverviewAction(projectId: string) {
  return pollAction("preProduction.pollOverview", pollNull, async (user) => {
    const overview = await loadCategories(projectId, user.id);
    return overview ? { busy: overview.busy, signature: overview.signature } : null;
  });
}
