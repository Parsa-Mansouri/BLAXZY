import { getScriptState, type ScriptVersionView } from "@/server/script";

export interface ScriptPoll {
  versionId: string | null;
  status: ScriptVersionView["status"] | null;
}

/** The latest version and its status, for the waiting screen. Null when the project is gone. */
export async function readScriptPoll(
  projectId: string,
  userId: string,
): Promise<ScriptPoll | null> {
  const state = await getScriptState(projectId, userId);
  if (!state) return null;
  return { versionId: state.current?.id ?? null, status: state.current?.status ?? null };
}
