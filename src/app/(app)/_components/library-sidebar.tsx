import { requireUser } from "@/server/auth";
import { LibrarySidebarView } from "./library-sidebar-view";

/**
 * The library sidebar, shown on every signed-in page outside a film: New Project, Home and the
 * account row. Inside a film the film navigator (`ProjectSidebar`) takes its place.
 */
export async function LibrarySidebar() {
  const user = await requireUser();
  return <LibrarySidebarView name={user.name} email={user.email} />;
}
