import { ProjectSidebar } from "../../../../_components/project-sidebar";

/** The same project sidebar on every stage route (`/projects/[id]/style`, `/script`, ...). */
export default async function ProjectStageSidebarSlot({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectSidebar projectId={id} />;
}
