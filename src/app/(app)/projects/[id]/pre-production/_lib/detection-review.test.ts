import { describe, expect, it } from "vitest";
import type { ReviewOption } from "@/server/damis";
import {
  buildSelections,
  categoryWarnings,
  draftWith,
  EMPTY_DRAFT,
  namedAssets,
  textPrompt,
  toggleTarget,
  type ReviewAsset,
} from "./detection-review";

function option(
  code: string,
  kind: ReviewOption["kind"],
  extra: Partial<ReviewOption> = {},
): ReviewOption {
  return {
    code,
    kind,
    label: code,
    needsText: false,
    proOnly: false,
    callsClaude: true,
    editEligible: false,
    ...extra,
  };
}

const OPTIONS: ReviewOption[] = [
  option("ADT01", "technical", { needsText: true, targetCount: 0, label: "Missing" }),
  option("ADT02", "technical", { targetCount: 2, label: "Same" }),
  option("ADT03", "technical", { targetCount: 1, label: "Two" }),
  option("ADT04", "technical", {
    targetCount: 1,
    needsText: true,
    label: "Category",
    followup: {
      type: "chips",
      allowCustom: false,
      options: [
        { label: "Character", value: "character" },
        { label: "Location", value: "location" },
        { label: "Prop", value: "prop" },
      ],
    },
  }),
  option("ADT05", "technical", { targetCount: 1, needsText: true, label: "Description" }),
  option("ADP01", "preference", { targetCount: 1, callsClaude: false }),
  option("ADP99", "preference", { needsText: true, targetCount: 0 }),
  option("ADR01", "regenerate"),
];

const MARA: ReviewAsset = { id: "a1", kind: "character", name: "Mara" };
const MARA2: ReviewAsset = { id: "a2", kind: "character", name: "Mara (2)" };
const JON: ReviewAsset = { id: "a3", kind: "character", name: "Jon" };
const ASSETS = [MARA, MARA2, JON];

describe("buildSelections", () => {
  it("needs a pick", () => {
    expect(buildSelections(EMPTY_DRAFT, OPTIONS, ASSETS)).toMatchObject({ ok: false });
  });

  it("sends targets as kind:Name refs", () => {
    const draft = draftWith("ADT02", { targets: ["a1", "a2"] });
    expect(buildSelections(draft, OPTIONS, ASSETS)).toEqual({
      ok: true,
      selections: [{ code: "ADT02", targetNames: ["character:Mara", "character:Mara (2)"] }],
    });
  });

  it("asks for two targets on a same-one reason", () => {
    const draft = draftWith("ADT02", { targets: ["a1"] });
    expect(buildSelections(draft, OPTIONS, ASSETS)).toMatchObject({ ok: false, code: "ADT02" });
  });

  it("requires text where the catalog does, and not for the optional split text", () => {
    expect(buildSelections(draftWith("ADT05", { targets: ["a1"] }), OPTIONS, ASSETS)).toMatchObject(
      { ok: false, code: "ADT05" },
    );
    expect(buildSelections(draftWith("ADT03", { targets: ["a3"] }), OPTIONS, ASSETS)).toEqual({
      ok: true,
      selections: [{ code: "ADT03", targetNames: ["character:Jon"] }],
    });
    expect(
      buildSelections(
        draftWith("ADT03", { targets: ["a3"], text: " old and young " }),
        OPTIONS,
        ASSETS,
      ),
    ).toEqual({
      ok: true,
      selections: [{ code: "ADT03", targetNames: ["character:Jon"], customText: "old and young" }],
    });
  });

  it("sends the category chip as value", () => {
    const draft = { ...draftWith("ADT04", { targets: ["a3"] }), values: { ADT04: "prop" } };
    expect(buildSelections(draft, OPTIONS, ASSETS)).toEqual({
      ok: true,
      selections: [{ code: "ADT04", targetNames: ["character:Jon"], value: "prop" }],
    });
    expect(buildSelections(draftWith("ADT04", { targets: ["a3"] }), OPTIONS, ASSETS)).toMatchObject(
      { ok: false, code: "ADT04" },
    );
  });

  it("keeps several reasons and the note", () => {
    const draft = {
      ...EMPTY_DRAFT,
      picked: ["ADT01", "ADP01"],
      texts: { ADT01: "The red car" },
      targets: { ADP01: ["a3"] },
      note: "  thanks ",
    };
    expect(buildSelections(draft, OPTIONS, ASSETS)).toEqual({
      ok: true,
      selections: [
        { code: "ADT01", customText: "The red car" },
        { code: "ADP01", targetNames: ["character:Jon"] },
      ],
      note: "thanks",
    });
  });
});

describe("textPrompt and toggleTarget", () => {
  it("has no text box for chip reasons", () => {
    expect(textPrompt(OPTIONS[3]!)).toBeNull();
    expect(textPrompt(OPTIONS[0]!)).toBe("What is missing?");
  });

  it("replaces a single target and toggles several", () => {
    expect(toggleTarget(["a1"], "a2", 1)).toEqual(["a2"]);
    expect(toggleTarget(["a1"], "a2", 2)).toEqual(["a1", "a2"]);
    expect(toggleTarget(["a1", "a2"], "a1", 2)).toEqual(["a2"]);
  });
});

describe("namedAssets", () => {
  it("matches whole names and prefers the longer one", () => {
    expect(namedAssets("Mara (2) and Jon may be the same", ASSETS)).toEqual([MARA2, JON]);
    expect(namedAssets("Mara and Mara (2) may be the same", ASSETS)).toEqual([MARA, MARA2]);
    expect(namedAssets("Jonas came alone", ASSETS)).toEqual([]);
  });
});

describe("categoryWarnings", () => {
  it("offers the same-one review for a merge check of this screen", () => {
    const [w] = categoryWarnings(
      [{ tag: "MERGE_CHECK", text: "Mara and Mara (2) may be the same (alias)" }],
      "character",
      ASSETS,
      OPTIONS,
    );
    expect(w?.fix).toEqual({ type: "same", label: "They're the Same", targets: ["a1", "a2"] });
  });

  it("hides merge checks and location gaps of other screens", () => {
    expect(
      categoryWarnings(
        [
          { tag: "MERGE_CHECK", text: "Kitchen and Old Kitchen may be the same" },
          { tag: "NO_LOCATION", text: "scene 4 has no stated place" },
        ],
        "character",
        ASSETS,
        OPTIONS,
      ),
    ).toEqual([]);
    const [loc] = categoryWarnings(
      [{ tag: "NO_LOCATION", text: "scene 4 has no stated place" }],
      "location",
      [],
      OPTIONS,
    );
    expect(loc?.fix).toEqual({ type: "review", label: "Name the Place", code: "ADT01" });
  });

  it("prefills a manual add from a missing thing and removes an approved conflict", () => {
    const [missing, conflict] = categoryWarnings(
      [
        { tag: "NOT_IN_SCRIPT", text: "the red car" },
        { tag: "APPROVED_CONFLICT", text: "Jon is no longer found in the script." },
      ],
      "character",
      ASSETS,
      OPTIONS,
    );
    expect(missing?.fix).toEqual({
      type: "add",
      label: "Add It Yourself",
      name: "the red car",
      description: "",
    });
    expect(conflict?.fix).toEqual({
      type: "remove",
      label: "Remove It",
      assetId: "a3",
      name: "Jon",
    });
  });
});
