import { requireUser } from "@/server/auth";
import { getBalance } from "@/server/billing";
import { listProjects } from "@/server/projects";
import { LibrarySidebarView } from "./library-sidebar-view";

const RECENT_COUNT = 8;

/** The library sidebar: Home, All Projects and the most recently updated projects. */
export async function LibrarySidebar() {
  const user = await requireUser();
  const [page, credits] = await Promise.all([
    listProjects({ ownerId: user.id, limit: RECENT_COUNT }),
    getBalance(user.id),
  ]);
  return (
    <LibrarySidebarView
      name={user.name}
      email={user.email}
      credits={credits}
      recent={page.items.map((p) => ({ id: p.id, title: p.title }))}
    />
  );
}
