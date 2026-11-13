import { loadBackgroundStatus } from "@/app/(app)/projects/[id]/_lib/background-status";
import { optionalUuid, pollRoute, uuidParam } from "../../../_lib/poll-route";

export const dynamic = "force-dynamic";

/**
 * Where detection and sectioning stand for the accepted script (`?accepted=<version id>`, absent
 * when there is none). Null when the project is gone.
 */
export const GET = pollRoute<{ id: string }>("script.backgroundStatus", ({ user, params, query }) =>
  loadBackgroundStatus(uuidParam(params.id), user.id, optionalUuid(query, "accepted")),
);
