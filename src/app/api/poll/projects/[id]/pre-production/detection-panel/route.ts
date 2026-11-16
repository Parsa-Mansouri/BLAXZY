import { getDetectionPanel } from "@/server/assets";
import { pollRoute, uuidParam } from "../../../../_lib/poll-route";

export const dynamic = "force-dynamic";

const MISSING = "This project no longer exists. It may have been archived.";

/** What the category screens show about the detected list. */
export const GET = pollRoute<{ id: string }>(
  "category.detectionPanel",
  async ({ user, params }) => {
    const panel = await getDetectionPanel(uuidParam(params.id), user.id);
    if (!panel) return { ok: false, error: MISSING };
    return { ok: true, data: panel };
  },
);
