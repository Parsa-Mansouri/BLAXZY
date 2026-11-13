import { readScriptPoll } from "@/app/(app)/projects/[id]/script/_lib/script-poll";
import { pollRoute, uuidParam } from "../../../_lib/poll-route";

export const dynamic = "force-dynamic";

/** The latest version and its status, for the waiting screen (null: the project is gone). */
export const GET = pollRoute<{ id: string }>("script.poll", ({ user, params }) =>
  readScriptPoll(uuidParam(params.id), user.id),
);
