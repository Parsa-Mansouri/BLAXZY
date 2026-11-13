"use server";

import { listFinishedAssetEvents, type FinishedFeedPage } from "@/server/assets";
import { pollAction, pollNull } from "./action";

/**
 * Looks and sheets that finished in the signed-in user's projects since `cursor` (null on the
 * first call, which only returns where to start). Null when signed out (a background poll must
 * not send the user to the sign-in page), rate limited or failing.
 */
export async function pollFinishedAction(cursor: string | null): Promise<FinishedFeedPage | null> {
  return pollAction("finishedFeed.poll", pollNull, (user) =>
    listFinishedAssetEvents(user.id, cursor),
  );
}
