import { readExport } from "@/app/(app)/projects/[id]/production/finished/_lib/read-export";
import { pollRoute, uuidParam } from "../../_lib/poll-route";

export const dynamic = "force-dynamic";

/** The state of a ZIP export, for the Finished screen. */
export const GET = pollRoute<{ exportId: string }>("finished.pollExport", ({ user, params }) =>
  readExport(uuidParam(params.exportId), user.id),
);
