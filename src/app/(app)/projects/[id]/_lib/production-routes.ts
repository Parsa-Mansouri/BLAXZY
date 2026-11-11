import type { ProductionPhase } from "@/server/production";
import { NOTICE_FLAG, type RouteNoticeKey } from "./route-notices";

/** Routes of the Production stage; the clips screens live in `production/clips`. */
export const productionHref = (projectId: string) => `/projects/${projectId}/production`;
export const blocksHref = (projectId: string) => `/projects/${projectId}/production/blocks`;
export const blockHref = (projectId: string, lineageId: string) =>
  `/projects/${projectId}/production/blocks/${lineageId}`;
export const clipsHref = (projectId: string) => `/projects/${projectId}/production/clips`;
export const clipHref = (projectId: string, lineageId: string) =>
  `${clipsHref(projectId)}/${encodeURIComponent(lineageId)}`;
export const finishedHref = (projectId: string) => `/projects/${projectId}/production/finished`;

/** The screens of Production that depend on where the shots stand. */
export type ProductionScreen = "blocks" | "clips" | "finished";

/** What the routing decision reads: the project's stage and the shots' overview. */
export interface ProductionRouteState {
  projectStage: "production" | "done";
  phase: ProductionPhase;
  /** Shots with an accepted final. */
  finalCount: number;
}

/**
 * Where Production opens: shot review while shots are prepared or reviewed, the clips while they
 * are made, the finished film once it is finished. Every shot final but the film not finished yet
 * opens the clips, where it is finished. A finished project whose shots are no longer all final
 * (reopened) follows its shots.
 */
export function productionDestination(state: ProductionRouteState): ProductionScreen {
  switch (state.phase) {
    case "preparing":
    case "block_review":
      return "blocks";
    case "generating":
      return "clips";
    case "finished":
      return state.projectStage === "done" ? "finished" : "clips";
  }
}

/**
 * Whether a screen can be shown as it is. The clips board always can; shot review while shots
 * are prepared or reviewed; the finished film once any clip is final (while the film is reopened
 * the final clips stay watchable there). The destination can always be shown, so a redirect
 * reaches a page that stays: no loops.
 */
export function canShowScreen(screen: ProductionScreen, state: ProductionRouteState): boolean {
  switch (screen) {
    case "blocks":
      return state.phase === "preparing" || state.phase === "block_review";
    case "clips":
      return true;
    case "finished":
      return state.finalCount > 0 || state.phase === "finished";
  }
}

/** Why a screen sent the user elsewhere: by the screen asked for and where it leads. */
function noticeFor(screen: ProductionScreen, destination: ProductionScreen): RouteNoticeKey {
  if (screen === "finished") return "not-finished";
  return destination === "finished" ? "film-finished" : "review-complete";
}

export function screenHref(projectId: string, screen: ProductionScreen): string {
  switch (screen) {
    case "blocks":
      return blocksHref(projectId);
    case "clips":
      return clipsHref(projectId);
    case "finished":
      return finishedHref(projectId);
  }
}

/**
 * The one routing decision of Production. `screen` is the page asked for (null: the stage's
 * entry, which always goes to the destination). Returns where to send the user (with a notice
 * that says why), or null when the page can be shown.
 */
export function productionRedirect(
  projectId: string,
  screen: ProductionScreen | null,
  state: ProductionRouteState,
): string | null {
  if (screen !== null && canShowScreen(screen, state)) return null;
  const destination = productionDestination(state);
  const href = screenHref(projectId, destination);
  return screen === null ? href : `${href}?${NOTICE_FLAG}=${noticeFor(screen, destination)}`;
}

/** A shot's review page once its clip is in the works: its clip page, with a notice. */
export function shotMovedHref(projectId: string, lineageId: string): string {
  return `${clipHref(projectId, lineageId)}?${NOTICE_FLAG}=${"shot-has-clip" satisfies RouteNoticeKey}`;
}

/** The Production screen that matches where the project's shots stand (client polling). */
export function phaseHref(
  projectId: string,
  phase: ProductionPhase,
  projectStage: "production" | "done" = "production",
): string {
  return screenHref(projectId, productionDestination({ projectStage, phase, finalCount: 0 }));
}
