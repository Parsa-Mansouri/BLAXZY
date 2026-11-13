import { listFinishedAssetEvents } from "@/server/assets";
import { pollRoute } from "../_lib/poll-route";

export const dynamic = "force-dynamic";

/**
 * Looks and sheets that finished in the signed-in user's projects since `?cursor=` (absent on
 * the first call, which only returns where to start). The service reads a malformed cursor as
 * "start now", so it is passed through as the server action did.
 */
export const GET = pollRoute("finishedFeed.poll", ({ user, query }) =>
  listFinishedAssetEvents(user.id, query.get("cursor")),
);
