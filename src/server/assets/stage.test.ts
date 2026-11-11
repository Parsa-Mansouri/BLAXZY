import { describe, expect, it } from "vitest";
import type { LookStatus } from "@/server/db/schema";
import { deriveAssetState, deriveAssetStage, type StageLook } from "./stage";

const look = (status: LookStatus, source: StageLook["source"] = "generated"): StageLook => ({
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
