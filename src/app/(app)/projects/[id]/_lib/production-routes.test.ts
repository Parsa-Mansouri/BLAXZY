import { describe, expect, it } from "vitest";
import type { ProductionPhase } from "@/server/production";
import {
  canShowScreen,
  productionDestination,
  productionRedirect,
  screenHref,
  type ProductionRouteState,
  type ProductionScreen,
} from "./production-routes";

const STAGES = ["production", "done"] as const;
const PHASES: ProductionPhase[] = ["preparing", "block_review", "generating", "finished"];
const FINALS = [0, 1, 7];
const SCREENS: (ProductionScreen | null)[] = [null, "blocks", "clips", "finished"];
const ID = "p1";

function states(): ProductionRouteState[] {
  return STAGES.flatMap((projectStage) =>
    PHASES.flatMap((phase) => FINALS.map((finalCount) => ({ projectStage, phase, finalCount }))),
  );
}

/** The screen a redirect lands on (the path without its notice). */
function screenOf(href: string): ProductionScreen {
  const path = href.split("?")[0];
  const found = (["blocks", "clips", "finished"] as const).find((s) => screenHref(ID, s) === path);
  if (!found) throw new Error(`not a production screen: ${href}`);
  return found;
}

describe("production routing", () => {
  it("reaches a page that stays in at most one hop, from every page and state", () => {
    for (const state of states()) {
      for (const screen of SCREENS) {
        const first = productionRedirect(ID, screen, state);
        if (first === null) continue;
        const landed = screenOf(first);
        expect(productionRedirect(ID, landed, state), `${screen} ${JSON.stringify(state)}`).toBe(
          null,
        );
      }
    }
  });

  it("can always show its destination", () => {
    for (const state of states()) {
      expect(canShowScreen(productionDestination(state), state)).toBe(true);
    }
  });

  it("follows the shots, also when a finished film was reopened", () => {
    const done = { projectStage: "done" as const, finalCount: 6 };
    expect(productionDestination({ ...done, phase: "finished" })).toBe("finished");
    expect(productionDestination({ ...done, phase: "preparing" })).toBe("blocks");
    expect(productionDestination({ ...done, phase: "block_review" })).toBe("blocks");
    expect(productionDestination({ ...done, phase: "generating" })).toBe("clips");
    // Every shot final, the film not finished yet: the clips board, where it is finished.
    expect(
      productionDestination({ projectStage: "production", phase: "finished", finalCount: 8 }),
    ).toBe("clips");
  });

  it("keeps final clips watchable while the film is reopened", () => {
    const reopened = { projectStage: "production" as const, phase: "block_review" as const };
    expect(productionRedirect(ID, "finished", { ...reopened, finalCount: 6 })).toBeNull();
    expect(productionRedirect(ID, "finished", { ...reopened, finalCount: 0 })).toBe(
      `${screenHref(ID, "blocks")}?notice=not-finished`,
    );
  });

  it("says why when it redirects a page, but not the entry", () => {
    const state = {
      projectStage: "production" as const,
      phase: "generating" as const,
      finalCount: 0,
    };
    expect(productionRedirect(ID, null, state)).toBe(screenHref(ID, "clips"));
    expect(productionRedirect(ID, "blocks", state)).toBe(
      `${screenHref(ID, "clips")}?notice=review-complete`,
    );
  });
});
