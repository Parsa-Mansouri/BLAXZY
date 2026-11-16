import { ProjectSidebar } from "../../../_components/project-sidebar";

/** A project's own address (it redirects to the current stage): the film navigator already. */
export default async function ProjectSidebarSlot({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectSidebar projectId={id} />;
}
