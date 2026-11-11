import { redirect } from "next/navigation";
import { currentStageHref, type ProjectStageKey } from "@/lib/stages";
import { canOpenStage } from "@/server/projects";
import { loadProject } from "./load-project";

/** Query flag on the redirect from a locked stage; the project layout shows a notice and removes it. */
export const LOCKED_FLAG = "locked";

/**
 * The project for a stage's page. Sends the user to the current stage when this one is still
 * locked, so a locked stage cannot be opened by typing its URL.
 */
export async function loadProjectForStage(projectId: string, stage: ProjectStageKey) {
  const project = await loadProject(projectId);
  if (!canOpenStage(project, stage))
    redirect(`${currentStageHref(project.id, project.stage)}?${LOCKED_FLAG}=1`);
  return project;
}
