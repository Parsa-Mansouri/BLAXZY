import { loadNavigator } from "@/app/(app)/projects/[id]/_lib/load-navigator";
import { pollRoute, uuidParam } from "../../../_lib/poll-route";

export const dynamic = "force-dynamic";

/** The film navigator of the in-film sidebar, with its signature (null: nothing to say). */
export const GET = pollRoute<{ id: string }>("project.pollNavigator", ({ user, params }) =>
  loadNavigator(uuidParam(params.id), user.id),
);
