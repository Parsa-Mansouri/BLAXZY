import { requireUser } from "@/server/auth";
import { getAssetKind } from "@/server/assets";
import { loadNavigator } from "../projects/[id]/_lib/load-navigator";
import { LibrarySidebar } from "./library-sidebar";
import { ProjectSidebarView } from "./project-sidebar-view";

/**
 * The in-film sidebar (the film navigator) for `/projects/<projectId>/<...path>`. A project that
 * is missing or not the user's falls back to the library sidebar (the page shows its not-found).
 */
export async function ProjectSidebar({
  projectId,
  path = [],
}: {
  projectId: string;
  /** The route segments below the project, e.g. `["pre-production", "assets", "<id>"]`. */
  path?: string[];
}) {
  const user = await requireUser();
  const assetId = path[0] === "pre-production" && path[1] === "assets" ? path[2] : undefined;
  const [view, assetKind] = await Promise.all([
    loadNavigator(projectId, user.id),
    assetId ? getAssetKind(assetId, user.id) : Promise.resolve(null),
  ]);
  if (!view) return <LibrarySidebar />;
  return (
    <ProjectSidebarView initial={view} assetKind={assetKind} name={user.name} email={user.email} />
  );
}
