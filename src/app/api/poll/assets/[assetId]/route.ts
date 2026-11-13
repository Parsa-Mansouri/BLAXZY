import { getAssetDetail } from "@/server/assets";
import { versionsKey } from "@/app/(app)/projects/[id]/pre-production/assets/[assetId]/_lib/asset-view";
import { pollRoute, uuidParam } from "../../_lib/poll-route";

export const dynamic = "force-dynamic";

/** A fingerprint of the asset's state, or null when the asset is gone. */
export const GET = pollRoute<{ assetId: string }>("asset.poll", async ({ user, params }) => {
  const detail = await getAssetDetail(uuidParam(params.assetId), user.id);
  return detail ? versionsKey(detail) : null;
});
