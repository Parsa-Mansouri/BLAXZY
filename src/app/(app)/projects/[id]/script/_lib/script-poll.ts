import { getProjectForUser } from "@/server/projects";
import { getScriptState, type ScriptVersionView } from "@/server/script";

export interface ScriptPoll {
  versionId: string | null;
  status: ScriptVersionView["status"] | null;
  /** The project's title now: Claude may have named the project while the script was written. */
  title: string;
}

/** The latest version, its status and the project title, for the waiting screen. Null when the project is gone. */
export async function readScriptPoll(
  projectId: string,
  userId: string,
): Promise<ScriptPoll | null> {
  const [state, project] = await Promise.all([
    getScriptState(projectId, userId),
    getProjectForUser(projectId, userId),
  ]);
  if (!state || !project) return null;
  return {
    versionId: state.current?.id ?? null,
    status: state.current?.status ?? null,
    title: project.title,
  };
}
