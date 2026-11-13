import {
  BOARD_PAGE_SIZE,
  readBoard,
} from "@/app/(app)/projects/[id]/production/clips/_lib/clip-data";
import { countParam, pollRoute, uuidParam } from "../../../_lib/poll-route";

export const dynamic = "force-dynamic";

const PROJECT_MISSING = "This project no longer exists. It may have been archived.";

/** The first `?count=` tiles again with the status line's counts. */
export const GET = pollRoute<{ id: string }>(
  "clips.refreshBoard",
  async ({ user, params, query }) => {
    const want = countParam(query, "count", BOARD_PAGE_SIZE, 500);
    const page = await readBoard(uuidParam(params.id), user.id, null, want);
    return page ? { ok: true, data: page } : { ok: false, error: PROJECT_MISSING };
  },
);
