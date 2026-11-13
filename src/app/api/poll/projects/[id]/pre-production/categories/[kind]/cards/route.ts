import { refreshCards } from "@/app/(app)/projects/[id]/pre-production/[kind]/_lib/read-cards";
import { countParam, pollRoute, uuidParam } from "../../../../../../_lib/poll-route";

export const dynamic = "force-dynamic";

/** The first `?count=` assets of a category again (24 to 500), with the stage counts. */
export const GET = pollRoute<{ id: string; kind: string }>(
  "category.refreshCards",
  ({ user, params, query }) =>
    refreshCards(uuidParam(params.id), user.id, params.kind, countParam(query, "count", 24, 500)),
);
