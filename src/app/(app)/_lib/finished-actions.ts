"use server";

import { listFinishedAssetEvents, type FinishedFeedPage } from "@/server/assets";
import { getSession } from "@/server/auth";

/**
 * Looks and sheets that finished in the signed-in user's projects since `cursor` (null on the
 * first call, which only returns where to start). Null when signed out: a background poll must
 * not send the user to the sign-in page.
 */
export async function pollFinishedAction(cursor: string | null): Promise<FinishedFeedPage | null> {
  const session = await getSession();
  if (!session?.user.emailVerified) return null;
  return listFinishedAssetEvents(session.user.id, cursor);
}
