import { getSectioningStatus } from "@/server/blocks";
import { pollRoute, uuidParam } from "../../../../_lib/poll-route";

export const dynamic = "force-dynamic";

/** Sectioning state and block count, polled while the shots are prepared (null: nothing to say). */
export const GET = pollRoute<{ id: string }>("preProduction.poll", async ({ user, params }) => {
  const status = await getSectioningStatus(uuidParam(params.id), user.id);
  return status ? { state: status.state, blockCount: status.blockCount } : null;
});
