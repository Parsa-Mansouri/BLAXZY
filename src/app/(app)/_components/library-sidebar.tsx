import { requireUser } from "@/server/auth";
import { getProjectForUser, listProjects } from "@/server/projects";
import { LibrarySidebarView } from "./library-sidebar-view";

const RECENT_COUNT = 8;

/**
 * The library sidebar, shown on every signed-in page: New Project, Home, Projects, the recently
 * updated films and the account row. Inside a project, that project's row is selected; if it is
 * not among the recent ones it is listed first.
 */
export async function LibrarySidebar({ currentProjectId }: { currentProjectId?: string } = {}) {
  const user = await requireUser();
  const page = await listProjects({ ownerId: user.id, limit: RECENT_COUNT });
  const recent = page.items.map((p) => ({ id: p.id, title: p.title }));
  if (currentProjectId && !recent.some((p) => p.id === currentProjectId)) {
    const current = await getProjectForUser(currentProjectId, user.id);
    if (current) recent.unshift({ id: current.id, title: current.title });
  }
  return <LibrarySidebarView name={user.name} email={user.email} recent={recent} />;
}
