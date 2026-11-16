import { ProjectSidebar } from "../../../../_components/project-sidebar";

/** Inside a project (`/projects/[id]/style`, ...): the film navigator. */
export default async function ProjectStageSidebarSlot({
  params,
}: {
  params: Promise<{ id: string; stage: string[] }>;
}) {
  const { id, stage } = await params;
  return <ProjectSidebar projectId={id} path={stage} />;
}
