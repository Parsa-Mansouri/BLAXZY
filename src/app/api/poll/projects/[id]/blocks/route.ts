import { refreshSnapshot } from "@/app/(app)/projects/[id]/production/blocks/_lib/read-snapshot";
import { countParam, pollRoute, uuidParam } from "../../../_lib/poll-route";

export const dynamic = "force-dynamic";

/** The first `?count=` shots again (50 to 500) with the counts. */
export const GET = pollRoute<{ id: string }>("blocks.refresh", ({ user, params, query }) =>
  refreshSnapshot(uuidParam(params.id), user.id, countParam(query, "count", 50, 500)),
);
