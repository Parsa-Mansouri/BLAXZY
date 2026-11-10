import { requireUser } from "@/server/auth";
import { listProjects } from "@/server/projects";
import { LibrarySidebarView } from "./library-sidebar-view";

const RECENT_COUNT = 8;

/** The library sidebar: Home, All Projects and the most recently updated projects. */
export async function LibrarySidebar() {
  const user = await requireUser();
  const page = await listProjects({ ownerId: user.id, limit: RECENT_COUNT });
  return (
    <LibrarySidebarView
      name={user.name}
      email={user.email}
      recent={page.items.map((p) => ({ id: p.id, title: p.title }))}
    />
  );
}
