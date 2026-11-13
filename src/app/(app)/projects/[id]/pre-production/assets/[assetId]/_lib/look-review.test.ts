import { describe, expect, it } from "vitest";
import type { ClientReviewOption } from "@/lib/review-option";
import {
  buildLookSelections,
  EMPTY_LOOK_DRAFT,
  exactReferences,
  fieldName,
  findReferenceConflict,
  groupSpecFields,
  nextReferences,
  regenerateOption,
  splitWarnings,
  type SpecField,
} from "./look-review";

function option(code: string, patch: Partial<ClientReviewOption> = {}): ClientReviewOption {
  return {
    code,
    kind: "technical",
    label: code,
    needsText: false,
    proOnly: false,
    takesValue: false,
    ...patch,
  };
}

const options: ClientReviewOption[] = [
  option("T01"),
  option("P01", {
    kind: "preference",
    takesValue: true,
    followup: {
      type: "chips_or_text",
      allowCustom: true,
      options: [{ label: "Older", value: "noticeably older" }],
    },
    conflictsWithReference: "face",
  }),
  option("LP03", { kind: "preference", needsText: true }),
  option("R01", { kind: "regenerate" }),
];

describe("buildLookSelections", () => {
  it("sends chips as values, words as custom text and the frame as the view", () => {
    const built = buildLookSelections(
      {
        ...EMPTY_LOOK_DRAFT,
        picked: ["T01", "P01", "LP03"],
        values: { P01: "noticeably older" },
        texts: { LP03: "  Late evening  " },
        views: { T01: "closeup" },
      },
      options,
      2000,
    );
    expect(built).toEqual({
      ok: true,
      selections: [
        { code: "T01", viewId: "closeup" },
        { code: "P01", value: "noticeably older" },
        { code: "LP03", customText: "Late evening" },
      ],
    });
  });

  it("asks for what a template or a text option needs", () => {
    const noValue = buildLookSelections({ ...EMPTY_LOOK_DRAFT, picked: ["P01"] }, options, 2000);
    expect(noValue).toMatchObject({ ok: false, code: "P01" });
    const noText = buildLookSelections({ ...EMPTY_LOOK_DRAFT, picked: ["LP03"] }, options, 2000);
    expect(noText).toMatchObject({ ok: false, code: "LP03" });
  });

  it("finds the re-roll option", () => {
    expect(regenerateOption(options)?.code).toBe("R01");
  });
});

describe("reference conflicts", () => {
  const references = [
    { fileId: "a", role: "face" },
    { fileId: "b", role: "outfit" },
  ];

  it("uses the character catalog's own marks", () => {
    const conflict = findReferenceConflict(["P01"], options, references, {
      key: "character",
      conflicts: {},
    });
    expect(conflict?.references).toEqual([{ fileId: "a", role: "face" }]);
    expect(
      findReferenceConflict(["T01"], options, references, { key: "character", conflicts: {} }),
    ).toBeNull();
  });

  it("uses the listed pairs for locations and props", () => {
    const conflict = findReferenceConflict(["LP03"], options, [{ fileId: "h", role: "hero" }], {
      key: "location",
      conflicts: { LP03: ["hero", "mood"] },
    });
    expect(conflict?.references.map((r) => r.fileId)).toEqual(["h"]);
  });

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
