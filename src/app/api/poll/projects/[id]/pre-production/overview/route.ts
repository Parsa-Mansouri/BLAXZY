import { loadCategories } from "@/app/(app)/projects/[id]/pre-production/_lib/load-categories";
import { pollRoute, uuidParam } from "../../../../_lib/poll-route";

export const dynamic = "force-dynamic";

/** Whether work is running and a signature of what the overview shows (null: nothing to say). */
export const GET = pollRoute<{ id: string }>(
  "preProduction.pollOverview",
  async ({ user, params }) => {
    const overview = await loadCategories(uuidParam(params.id), user.id);
    return overview ? { busy: overview.busy, signature: overview.signature } : null;
  },
);
