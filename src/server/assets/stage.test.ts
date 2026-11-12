import { describe, expect, it } from "vitest";
import { ASSET_KINDS, type AssetLookStatus, type LookStatus } from "@/server/db/schema";
import {
  deriveAssetState,
  deriveAssetStage,
  pickNextAsset,
  type OrderedAsset,
  type StageLook,
} from "./stage";

const look = (status: AssetLookStatus, source: StageLook["source"] = "generated"): StageLook => ({
  id: "look-1",
  status,
  source,
});
const sheet = (status: LookStatus, lookId = "look-1") => ({ lookId, status });

describe("deriveAssetStage", () => {
  it("image assets follow the look, then the sheet built from it", () => {
    expect(deriveAssetStage("character", null, null)).toBe("needs_image");
    expect(deriveAssetStage("character", look("pending"), null)).toBe("generating");
    expect(deriveAssetStage("location", look("in_review", "uploaded"), null)).toBe("look_review");
    expect(deriveAssetStage("prop", look("accepted"), null)).toBe("building_sheet");
    expect(deriveAssetStage("prop", look("accepted"), sheet("pending"))).toBe("building_sheet");
    expect(deriveAssetStage("prop", look("accepted"), sheet("in_review"))).toBe("sheet_review");
    expect(deriveAssetStage("prop", look("accepted"), sheet("accepted"))).toBe("ready");
  });

  it("reports what failed", () => {
    expect(deriveAssetState("character", look("failed"), null)).toMatchObject({
      stage: "failed",
      failed: "look",
      busy: false,
    });
    expect(deriveAssetState("character", look("accepted"), sheet("failed"))).toMatchObject({
      stage: "failed",
      failed: "sheet",
    });
  });

  it("goes back to needs_image after an uploaded look is rejected or the look is replaced", () => {
    expect(deriveAssetStage("character", look("rejected", "uploaded"), null)).toBe("needs_image");
    expect(deriveAssetStage("character", look("superseded"), sheet("superseded"))).toBe(
      "needs_image",
    );
  });

  it("ignores a sheet that belongs to an older look", () => {
    expect(deriveAssetStage("creature", look("accepted"), sheet("accepted", "old-look"))).toBe(
      "building_sheet",
    );
  });

  it("waits for an answer when the designer asked a blocking question", () => {
    expect(deriveAssetState("prop", look("needs_input"), null)).toMatchObject({
      stage: "needs_answer",
      busy: false,
    });
  });

  it("is busy while a look or a sheet is pending", () => {
    expect(deriveAssetState("character", look("pending"), null).busy).toBe(true);
    expect(deriveAssetState("character", look("accepted"), sheet("pending")).busy).toBe(true);
    expect(deriveAssetState("character", look("accepted"), sheet("in_review")).busy).toBe(false);
  });

  it("voices need a recording and are ready once one is accepted", () => {
    expect(deriveAssetStage("voice", null, null)).toBe("needs_recording");
    expect(deriveAssetStage("voice", look("accepted", "uploaded"), null)).toBe("ready");
    expect(deriveAssetStage("voice", look("superseded", "uploaded"), null)).toBe("needs_recording");
  });
});

describe("pickNextAsset", () => {
  const a = (
    id: string,
    kind: OrderedAsset["kind"],
    displayOrder: number,
    stage: OrderedAsset["stage"],
  ): OrderedAsset => ({ id, kind, displayOrder, stage });
  const pick = (assets: OrderedAsset[], after: string) =>
    pickNextAsset(assets, after, ASSET_KINDS)?.id ?? null;

  it("goes to the next asset that waits, in kind then display order", () => {
    const assets = [
      a("prop-1", "prop", 0, "needs_image"),
      a("loc-2", "location", 1, "look_review"),
      a("char-1", "character", 0, "generating"),
      a("loc-1", "location", 0, "ready"),
      a("char-2", "character", 1, "building_sheet"),
    ];
    expect(pick(assets, "char-1")).toBe("loc-2");
    expect(pick(assets, "loc-2")).toBe("prop-1");
  });

  it("wraps around to the start and never returns the current asset", () => {
    const assets = [
      a("char-1", "character", 0, "sheet_review"),
      a("loc-1", "location", 0, "ready"),
      a("voice-1", "voice", 0, "needs_recording"),
    ];
    expect(pick(assets, "voice-1")).toBe("char-1");
    expect(pick([a("char-1", "character", 0, "needs_image")], "char-1")).toBeNull();
  });

  it("counts failed assets as waiting and skips working or ready ones", () => {
    const assets = [
      a("char-1", "character", 0, "generating"),
      a("char-2", "character", 1, "ready"),
      a("char-3", "character", 2, "building_sheet"),
      a("prop-1", "prop", 0, "failed"),
    ];
    expect(pick(assets, "char-1")).toBe("prop-1");
    expect(pick(assets.slice(0, 3), "char-1")).toBeNull();
  });

  it("breaks display-order ties by id and starts at the top when the asset is unknown", () => {
    const assets = [a("b", "character", 0, "needs_image"), a("a", "character", 0, "needs_image")];
    expect(pick(assets, "a")).toBe("b");
    expect(pick(assets, "missing")).toBe("a");
  });
});
