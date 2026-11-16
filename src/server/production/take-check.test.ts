import { describe, expect, it } from "vitest";
import { testDirection } from "@/server/test-support/direction-fixtures";
import { reviewFindings } from "./findings";
import {
  actualBinding,
  correctedReferences,
  directionAssetNames,
  expectedBinding,
  reviewAssetId,
  type BoundAsset,
} from "./review-binding";
import { continuityOf, pickSheets, plannedWindows, usableDirection } from "./take-check";

const bound: BoundAsset[] = [
  {
    token: "image_1",
    ref: "location:Lighthouse",
    reviewId: "loc_1",
    name: "Lighthouse",
    kind: "location",
    fileId: "f-loc",
  },
  {
    token: "image_2",
    ref: "character:Tomas",
    reviewId: "char_1",
    name: "Tomas",
    kind: "character",
    fileId: "f-tomas",
  },
];

describe("usableDirection", () => {
  it("accepts a complete block and refuses old or partial ones", () => {
    expect(usableDirection(testDirection())?.block_id).toBe(1);
    expect(usableDirection(null)).toBeNull();
    expect(usableDirection({ shots: [] })).toBeNull();
    expect(usableDirection({ ...testDirection(), shots: [] })).toBeNull();
  });
});

describe("plannedWindows", () => {
  it("reads each shot's window and skips ones it cannot read", () => {
    const block = testDirection({ windows: ["0-4s", "4.5-9s", "later"] });
    expect(plannedWindows(block)).toEqual([
      { label: "0-4s", startS: 0, endS: 4, shot: 1 },
      { label: "4.5-9s", startS: 4.5, endS: 9, shot: 2 },
    ]);
  });
});

describe("the reference binding", () => {
  it("names assets by the Director's id when the direction knows them", () => {
    const names = directionAssetNames(testDirection());
    expect(reviewAssetId({ assetId: "uuid-1", kind: "character", name: "TOMAS" }, names)).toBe(
      "char_1",
    );
    expect(reviewAssetId({ assetId: "uuid-2", kind: "prop", name: "Lamp" }, names)).toBe("uuid-2");
    expect(directionAssetNames(null)).toEqual({});
  });

  it("expects the current files and reads what was attached", () => {
    expect(expectedBinding(bound)).toEqual([
      { token: "image_1", asset_id: "loc_1", sheet_id: "f-loc" },
      { token: "image_2", asset_id: "char_1", sheet_id: "f-tomas" },
    ]);
    const owners = new Map([
      ["f-loc", "loc_1"],
      ["f-tomas", "char_1"],
    ]);
    // Right, then a file that belongs to nobody now (an old sheet of the expected asset).
    expect(actualBinding(bound, ["f-loc", "f-old"], owners)).toEqual([
      { token: "image_1", asset_id: "loc_1", sheet_id: "f-loc" },
      { token: "image_2", asset_id: "char_1", sheet_id: "f-old" },
    ]);
    // Swapped files read as the other asset; a short list has no entry for the missing token.
    expect(actualBinding(bound, ["f-tomas"], owners)).toEqual([
      { token: "image_1", asset_id: "char_1", sheet_id: "f-tomas" },
    ]);
  });

  it("fixes only the named tokens and fills a missing one", () => {
    const fixed = correctedReferences(
      bound,
      ["f-loc", "f-old"],
      new Set(["image_2"]),
      () => new Error("x"),
    );
    expect(fixed).toEqual(["f-loc", "f-tomas"]);
    expect(correctedReferences(bound, ["f-loc"], new Set(), () => new Error("x"))).toEqual([
      "f-loc",
      "f-tomas",
    ]);
    expect(() =>
      correctedReferences(
        [{ ...bound[0]!, fileId: null }],
        [],
        new Set(["image_1"]),
        (a) => new Error(a.name),
      ),
    ).toThrow("Lighthouse");
  });
});

describe("pickSheets", () => {
  const others = [
    { reviewId: "char_2", name: "Ines", fileId: "f-ines" },
    { reviewId: "char_1", name: "Tomas", fileId: "f-tomas" },
    { reviewId: "char_3", name: "Ravi", fileId: "f-ravi" },
  ];
  it("lists the bound assets first, then other people, once each", () => {
    expect(pickSheets({ bound, others, imageBudget: 40 }).map((s) => s.asset_id)).toEqual([
      "loc_1",
      "char_1",
      "char_2",
      "char_3",
    ]);
  });
  it("stays inside the image budget", () => {
    expect(pickSheets({ bound, others, imageBudget: 3 })).toHaveLength(3);
    expect(pickSheets({ bound, others, imageBudget: 0 })).toEqual([]);
  });
});

describe("continuityOf", () => {
  it("reads descriptors and landmarks from the direction header", () => {
    const header = {
      continuity_bible: {
        characters: [{ asset_id: "char_1", name: "Tomas", descriptor: "Weathered keeper" }],
        locations: [{ asset_id: "loc_1", descriptor: "Stone tower", landmarks: ["red door"] }],
        props: [],
      },
    };
    expect(continuityOf(header)).toEqual({
      descriptors: [
        { asset_id: "char_1", name: "Tomas", descriptor: "Weathered keeper" },
        { asset_id: "loc_1", name: undefined, descriptor: "Stone tower" },
      ],
      landmarks: [{ asset_id: "loc_1", landmarks: ["red door"] }],
    });
    expect(continuityOf(null)).toBeUndefined();
    expect(continuityOf({})).toBeUndefined();
  });
});

describe("reviewFindings", () => {
  it("is empty until the report is there, and a ready state without a report counts as failed", () => {
    expect(reviewFindings("pending", null)).toEqual({ state: "pending", findings: [], keeps: [] });
    expect(reviewFindings("skipped", null).state).toBe("skipped");
    expect(reviewFindings("ready", null).state).toBe("failed");
  });
});
