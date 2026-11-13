import { getBlockDetail } from "@/server/production";
import { detailKey } from "@/app/(app)/projects/[id]/production/clips/_lib/clip-view";
import { pollRoute, uuidParam } from "../../_lib/poll-route";

export const dynamic = "force-dynamic";

/** A fingerprint of the shot's state, polled by the clip page, or null when the shot is gone. */
export const GET = pollRoute<{ lineageId: string }>("clips.poll", async ({ user, params }) => {
  const detail = await getBlockDetail(uuidParam(params.lineageId), user.id);
  return detail ? detailKey(detail) : null;
});
