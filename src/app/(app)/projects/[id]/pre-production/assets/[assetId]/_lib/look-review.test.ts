import { describe, expect, it } from "vitest";
import {
  exactReferences,
  fieldName,
  groupSpecFields,
  nextReferences,
  splitWarnings,
  type SpecField,
} from "./look-review";

describe("reference photos", () => {
  const references = [
    { fileId: "a", role: "face" },
    { fileId: "b", role: "outfit" },
  ];

  it("drops or replaces the photos", () => {
    expect(nextReferences(references, [references[0]!])).toEqual([references[1]]);
    expect(nextReferences(references, [references[0]!], { fileId: "new" })).toEqual([
      { fileId: "new", role: "face" },
      references[1],
    ]);
    expect(
      exactReferences([
        { fileId: "m", role: "mood" },
        { fileId: "i", role: "identity" },
      ]),
    ).toEqual([{ fileId: "i", role: "identity" }]);
  });
});

describe("warnings and the spec card", () => {
  it("takes the two conflicts out of the warnings", () => {
    expect(
      splitWarnings([
        "REFERENCE_CONFLICT: The photo shows brass.",
        "LOCATION_CONFLICT: The Hero shows it red.",
        "No script slice.",
      ]),
    ).toEqual({
      referenceConflict: "The photo shows brass.",
      locationConflict: "The Hero shows it red.",
      others: ["No script slice."],
    });
  });

  it("groups fields in the owner's order and names them plainly", () => {
    const field = (group: string | undefined, name: string): SpecField => ({
      ...(group ? { group } : {}),
      field: name,
      value: "x",
      status: "inferred",
      source: "design",
      critical: false,
    });
    const groups = groupSpecFields([field("Visual", "Era"), field("Identity", "Type")]);
    expect(groups.map((g) => g.label)).toEqual(["Identity", "Visual"]);
    expect(groupSpecFields([field(undefined, "scale")])[0]?.label).toBeNull();
    expect(fieldName("back_and_underside")).toBe("Back and underside");
  });
});
