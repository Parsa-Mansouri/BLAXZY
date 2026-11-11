"use server";

import { requireUser } from "@/server/auth";
import { loadOverview } from "../../_lib/load-overview";

/** What the overview polls: whether work is running and a signature of what it shows. */
export async function pollOverviewAction(projectId: string) {
  const user = await requireUser();
  const overview = await loadOverview(projectId, user.id);
  return overview ? { busy: overview.busy, signature: overview.signature } : null;
}
