import { getDetectionPanel } from "@/server/assets";
import { toClientOptions } from "@/lib/review-option";
import { pollRoute, uuidParam } from "../../../../_lib/poll-route";

export const dynamic = "force-dynamic";

const MISSING = "This project no longer exists. It may have been archived.";

/**
 * What the category screens show about the detected list. The options are projected to the
 * client-safe shape here: the fix instructions sent to the model stay on the server.
 */
export const GET = pollRoute<{ id: string }>(
  "category.detectionPanel",
  async ({ user, params }) => {
    const panel = await getDetectionPanel(uuidParam(params.id), user.id);
    if (!panel) return { ok: false, error: MISSING };
    return { ok: true, data: { ...panel, options: toClientOptions(panel.options) } };
  },
);
