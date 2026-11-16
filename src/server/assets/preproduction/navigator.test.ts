import { describe, expect, it } from "vitest";
import type { AssetStage } from "../stage";
import { navigatorCounts } from "./read";
import type { AssetKind } from "@/server/db/schema";

const row = (id: string, kind: AssetKind, stage: AssetStage) => ({
  id,
  name: `N${id}`,
  kind,
  stage,
});

describe("navigatorCounts", () => {
  it("counts per kind what waits for the user, what is being made and what failed", () => {
    const result = navigatorCounts([
      row("1", "character", "look_review"),
      row("2", "character", "sheet_review"),
      row("3", "character", "needs_answer"),
      row("4", "character", "generating"),
      row("5", "character", "ready"),
      row("6", "location", "building_sheet"),
      row("7", "location", "failed"),
      row("8", "location", "needs_image"),
      row("9", "voice", "needs_recording"),
    ]);
    expect(result.kinds).toEqual([
      { kind: "character", toReview: 3, rendering: 1, failed: 0 },
      { kind: "location", toReview: 0, rendering: 1, failed: 1 },
      { kind: "voice", toReview: 0, rendering: 0, failed: 0 },
    ]);
    expect(result.busy).toEqual([
      { id: "4", name: "N4", kind: "character" },
      { id: "6", name: "N6", kind: "location" },
    ]);
    expect(result.moreBusy).toBe(0);
  });

  it("leaves out kinds without assets and keeps the kinds' display order", () => {
    const result = navigatorCounts([row("1", "prop", "ready"), row("2", "character", "ready")]);
    expect(result.kinds.map((k) => k.kind)).toEqual(["character", "prop"]);
    expect(navigatorCounts([])).toEqual({ kinds: [], busy: [], moreBusy: 0 });
  });

  it("names at most five busy assets in their order and counts the rest", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(String(i), "prop", "generating"));
    const result = navigatorCounts(rows);
    expect(result.busy.map((b) => b.id)).toEqual(["0", "1", "2", "3", "4"]);
    expect(result.moreBusy).toBe(3);
    expect(navigatorCounts(rows, 2).moreBusy).toBe(6);
  });
});
