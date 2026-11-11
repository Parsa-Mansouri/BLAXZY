import type { ProductionPhase } from "@/server/production";

/** Routes of the Production stage; the clips screens live in `production/clips`. */
export const productionHref = (projectId: string) => `/projects/${projectId}/production`;
export const blocksHref = (projectId: string) => `/projects/${projectId}/production/blocks`;
export const blockHref = (projectId: string, lineageId: string) =>
  `/projects/${projectId}/production/blocks/${lineageId}`;
export const clipsHref = (projectId: string) => `/projects/${projectId}/production/clips`;
export const finishedHref = (projectId: string) => `/projects/${projectId}/production/finished`;

/** The Production screen that matches where the project's shots stand. */
export function phaseHref(projectId: string, phase: ProductionPhase): string {
  switch (phase) {
    case "preparing":
    case "block_review":
      return blocksHref(projectId);
    case "generating":
      return clipsHref(projectId);
    case "finished":
      return finishedHref(projectId);
  }
}
