import { getBlockDetail } from "@/server/production";
import { blockKey } from "@/app/(app)/projects/[id]/production/blocks/_lib/block-key";
import { pollRoute, uuidParam } from "../../_lib/poll-route";

export const dynamic = "force-dynamic";

/** A fingerprint of a shot's state while it is prepared, or null when the shot is gone. */
export const GET = pollRoute<{ lineageId: string }>("blocks.poll", async ({ user, params }) => {
  const detail = await getBlockDetail(uuidParam(params.lineageId), user.id);
  return detail ? blockKey(detail) : null;
});
