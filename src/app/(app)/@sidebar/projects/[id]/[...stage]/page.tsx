import { LibrarySidebar } from "../../../../_components/library-sidebar";

/** The same library sidebar on every page inside a project (`/projects/[id]/style`, ...). */
export default async function ProjectStageSidebarSlot({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LibrarySidebar currentProjectId={id} />;
}
