import { describe, expect, it } from "vitest";
import { excerptSimilarity } from "./lineage";

describe("excerptSimilarity", () => {
  it("finds an edited line close and a replaced shot far", () => {
    const before = "TOMAS You came. I wasn't sure you would. MARA I said I would.";
    const edited = "TOMAS You came back. I wasn't sure you would. MARA I said I would.";
    expect(excerptSimilarity(before, edited)).toBeGreaterThan(0.85);
    expect(excerptSimilarity("They meet.", "Something new.")).toBe(0);
    expect(excerptSimilarity("The beam sweeps the sea.", "Dawn over the rocks.")).toBeLessThan(0.6);
  });

  it("ignores case, spacing and punctuation, and handles empty text", () => {
    expect(excerptSimilarity("Mara  runs.", "mara runs")).toBe(1);
    expect(excerptSimilarity("", "Mara runs.")).toBe(0);
  });
});
