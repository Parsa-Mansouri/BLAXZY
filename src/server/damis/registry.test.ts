import { describe, expect, it } from "vitest";
import { DAMIS, SAMPLE_GENERATORS } from "./index";

describe("dami registry", () => {
  it("lists every live dami once, each with a sample generator (and no orphan generators)", () => {
    const keys = Object.keys(DAMIS).sort();
    for (const [key, dami] of Object.entries(DAMIS)) expect(dami.key).toBe(key);
    expect(Object.keys(SAMPLE_GENERATORS).sort()).toEqual(keys);
    expect(keys).toEqual(
      [
        "asset-detector",
        "character-generator",
        "block-revision",
        "creative-dna",
        "director",
        "director-plan",
        "enhancer",
        "location-generator",
        "project-namer",
        "prop-generator",
        "script-checker",
        "script-reviser",
        "script-writer",
        "script-writer-outline",
        "sheet-generator-character",
        "sheet-generator-location",
        "sheet-generator-prop",
        "video-review",
      ].sort(),
    );
  });
});
