import { describe, expect, it } from "vitest";
import type { LocationSheetOutput } from "../../src/server/damis";
import model from "../../src/server/damis/sheet-generator-location/fixtures/model-output.json";
import { anchorNames, locationViews } from "./asset-sheet-pack";

describe("location pack views", () => {
  const output = model as LocationSheetOutput;
  const anchorIds = output.views.flatMap((v) => v.must_show.map((m) => m.anchor_id));

  it("names each must-show anchor by the design's anchor name, not its id", () => {
    const design = {
      dna: {
        fixed_anchors: anchorIds.map((id, i) => ({ id, name: `Anchor ${i + 1}`, where: "" })),
      },
    };
    const names = anchorNames(design);
    const views = locationViews(output, "hero", names);
    const lines = views.flatMap((v) => v.mustShow);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.startsWith("Anchor "))).toBe(true);
  });

  it("falls back to the id, in words, when the design has no anchors", () => {
    expect(anchorNames({}).size).toBe(0);
    const views = locationViews(output, "hero", anchorNames(null));
    const first = anchorIds[0]?.replace(/_/g, " ") ?? "";
    expect(views.flatMap((v) => v.mustShow).some((l) => l.startsWith(`${first}:`))).toBe(true);
  });
});
