"use server";

import { requireUser } from "@/server/auth";
import { loadCategories } from "../_lib/load-categories";

/** What the overview polls: whether work is running and a signature of what it shows. */
export async function pollOverviewAction(projectId: string) {
  const user = await requireUser();
  const overview = await loadCategories(projectId, user.id);
  return overview ? { busy: overview.busy, signature: overview.signature } : null;
}
