import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { ensurePrepared, getProductionOverview } from "@/server/production";
import { loadProjectForStage } from "./load-stage";
import {
  productionRedirect,
  type ProductionRouteState,
  type ProductionScreen,
} from "./production-routes";

/**
 * Entering any Production page: prepares the shots that need it (and reopens a finished film
 * whose shots are no longer all final), then reads the overview. When this visit reopened the
 * film, the page is loaded once more so the stage shown around it is current. `screen` is the
 * page's screen when it depends on where the shots stand: it redirects (with a notice) when that
 * screen cannot be shown; null for pages that decide for themselves.
 */
export async function loadProduction(
  projectId: string,
  page: { screen: ProductionScreen | null; href: (projectId: string) => string } | "entry",
) {
  const project = await loadProjectForStage(projectId, "production");
  const user = await requireUser();
  const { reopened } = await ensurePrepared(project.id, user.id);
  const overview = await getProductionOverview(project.id, user.id);
  if (!overview) notFound();
  const state: ProductionRouteState = {
    projectStage: overview.projectStage,
    phase: overview.phase,
    finalCount: overview.counts.done,
  };
  if (page === "entry") redirect(productionRedirect(project.id, null, state) ?? "/projects");
  if (page.screen !== null) {
    const target = productionRedirect(project.id, page.screen, state);
    if (target) redirect(target);
  }
  if (reopened) redirect(page.href(project.id));
  return { project: { ...project, stage: overview.projectStage }, user, overview, state };
}
