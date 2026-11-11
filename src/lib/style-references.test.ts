import { describe, expect, it } from "vitest";
import {
  cleanTitles,
  describeReference,
  hasReference,
  normalizeReference,
  summarizeReference,
} from "./style-references";

const ID_A = "6f1f0b8e-2f4a-4b8e-9d2a-0c6b1f0e3a11";
const ID_B = "7a2e1c9f-3b5d-4c9f-8e3b-1d7c2a1f4b22";

describe("cleanTitles", () => {
  it("trims, collapses spaces and drops empty and repeated names", () => {
    expect(cleanTitles(["  Blade  Runner ", "", "blade runner", "Arrival"])).toEqual([
      "Blade Runner",
      "Arrival",
    ]);
  });
});

describe("hasReference", () => {
  it("needs at least one of names, images or a description", () => {
    expect(hasReference({ titles: [" "], description: "  ", fileIds: [] })).toBe(false);
    expect(hasReference({ titles: ["Heat"], fileIds: [] })).toBe(true);
    expect(hasReference({ titles: [], fileIds: [ID_A] })).toBe(true);
    expect(hasReference({ titles: [], description: "Grainy", fileIds: [] })).toBe(true);
  });
});

describe("describeReference", () => {
  it("joins names and the description into one readable value", () => {
    expect(
      describeReference({
        titles: ["Blade Runner", "Arrival", "Heat"],
        description: "Cold neon at night.",
        fileIds: [ID_A],
      }),
    ).toBe("Like Blade Runner, Arrival and Heat. Cold neon at night.");
  });
  it("names the images when nothing else was given", () => {
    expect(describeReference({ titles: [], fileIds: [ID_A, ID_B] })).toBe(
      "As in the reference images.",
    );
  });
});

describe("summarizeReference", () => {
  it("prefers the first name, then the description, then the images", () => {
    expect(summarizeReference({ titles: ["Heat", "Ronin"], fileIds: [] })).toBe("Heat and 1 more");
    expect(summarizeReference({ titles: [], description: "a".repeat(60), fileIds: [] }, 10)).toBe(
      `${"a".repeat(9)}…`,
    );
    expect(summarizeReference({ titles: [], fileIds: [ID_A] })).toBe("1 reference image");
  });
});

describe("normalizeReference", () => {
  it("drops an empty description and repeated images", () => {
    expect(normalizeReference({ titles: [], description: " ", fileIds: [ID_A, ID_A] })).toEqual({
      titles: [],
      fileIds: [ID_A],
    });
  });
});
