import { requireUser } from "@/server/auth";
import { getBalance } from "@/server/billing";
import { stageViews } from "@/lib/stages";
import { loadProject } from "../projects/[id]/_lib/load-project";
import { ProjectSidebarView } from "./project-sidebar-view";

/** Inside a project the sidebar becomes that project: a way back, its title and its stages. */
export async function ProjectSidebar({ projectId }: { projectId: string }) {
  const [user, project] = await Promise.all([requireUser(), loadProject(projectId)]);
  const credits = await getBalance(user.id);
  return (
    <ProjectSidebarView
      name={user.name}
      email={user.email}
      credits={credits}
      title={project.title}
      stages={stageViews(project.stage, project.id).map((stage) => ({
        id: stage.key,
        label: stage.label,
        status: stage.status,
        href: stage.href,
        lockedHint: stage.lockedHint,
      }))}
    />
  );
}
