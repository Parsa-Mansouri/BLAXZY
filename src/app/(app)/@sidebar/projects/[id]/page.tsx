import { LibrarySidebar } from "../../../_components/library-sidebar";

/** Inside a project the library sidebar stays, with that project's row selected. */
export default async function ProjectSidebarSlot({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LibrarySidebar currentProjectId={id} />;
}
