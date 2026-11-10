import { ProjectSidebar } from "../../../_components/project-sidebar";

export default async function ProjectSidebarSlot({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectSidebar projectId={id} />;
}
