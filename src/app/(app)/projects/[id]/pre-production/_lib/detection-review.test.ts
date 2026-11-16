import { describe, expect, it } from "vitest";
import {
  aboutAsset,
  assetRef,
  categoryWarnings,
  namedAssets,
  type ReviewAsset,
} from "./detection-review";

const MARA: ReviewAsset = { id: "a1", kind: "character", name: "Mara" };
const MARA2: ReviewAsset = { id: "a2", kind: "character", name: "Mara (2)" };
const JON: ReviewAsset = { id: "a3", kind: "character", name: "Jon" };
const ASSETS = [MARA, MARA2, JON];

describe("assetRef and aboutAsset", () => {
  it("names an asset as the detector does", () => {
    expect(assetRef(MARA2)).toBe("character:Mara (2)");
  });

  it("starts a note about one asset", () => {
    expect(aboutAsset(JON)).toBe("About Jon: ");
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
  it("opens the review box with a sentence for a merge check of this screen", () => {
    const [w] = categoryWarnings(
      [{ tag: "MERGE_CHECK", text: "Mara and Mara (2) may be the same (alias)" }],
      "character",
      ASSETS,
    );
    expect(w?.fix).toEqual({
      type: "review",
      label: "They're the Same",
      note: "Mara and Mara (2) are the same character. Keep one of them.",
    });
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
      ),
    ).toEqual([]);
    const [loc] = categoryWarnings(
      [{ tag: "NO_LOCATION", text: "scene 4 has no stated place" }],
      "location",
      [],
    );
    expect(loc?.fix).toEqual({
      type: "review",
      label: "Name the Place",
      note: "The place of the scene is: ",
    });
  });

  it("prefills a manual add from a missing thing and removes an approved conflict", () => {
    const [missing, conflict] = categoryWarnings(
      [
        { tag: "NOT_IN_SCRIPT", text: "the red car" },
        { tag: "APPROVED_CONFLICT", text: "Jon is no longer found in the script." },
      ],
      "character",
      ASSETS,
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
