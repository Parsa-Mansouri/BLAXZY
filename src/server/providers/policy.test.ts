import { describe, expect, it } from "vitest";
import { GENERATION_PURPOSES, type ProjectStyle } from "@/server/db/schema";
import { clampDurationSeconds, MODEL_POLICY, pickModel } from "@/server/providers/policy";

const landscape: ProjectStyle = {
  visualStyle: "Cinematic live-action",
  genre: "Drama",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: 90,
};
const portrait: ProjectStyle = { ...landscape, orientation: "portrait" };

describe("pickModel", () => {
  it("uses an image model for looks and sheets and a video model for blocks", () => {
    expect(pickModel("asset_look", landscape)).toMatchObject({ kind: "image" });
    expect(pickModel("asset_sheet", landscape)).toMatchObject({ kind: "image" });
    expect(pickModel("block_draft", landscape)).toMatchObject({ kind: "video" });
    expect(pickModel("block_final", landscape)).toMatchObject({ kind: "video" });
    expect(pickModel("asset_look", landscape).model).toBe(MODEL_POLICY.asset_look.model);
    expect(pickModel("block_final", landscape).model).toBe(MODEL_POLICY.block_final.model);
  });

  it("takes an aspect-ratio override, but only 16:9 or 9:16 for video", () => {
    expect(pickModel("asset_look", landscape, {}, { aspectRatio: "3:4" }).params.aspectRatio).toBe(
      "3:4",
    );
    expect(pickModel("asset_sheet", portrait, {}, { aspectRatio: "1:1" }).params.aspectRatio).toBe(
      "1:1",
    );
    expect(
      pickModel("block_draft", landscape, {}, { aspectRatio: "9:16" }).params.aspectRatio,
    ).toBe("9:16");
    expect(() => pickModel("block_draft", landscape, {}, { aspectRatio: "1:1" })).toThrow(/16:9/);
  });

  it("follows the project's orientation for looks and shots", () => {
    expect(pickModel("asset_look", landscape).params.aspectRatio).toBe("16:9");
    expect(pickModel("asset_look", portrait).params.aspectRatio).toBe("9:16");
    expect(pickModel("block_draft", portrait).params.aspectRatio).toBe("9:16");
    expect(pickModel("block_final", landscape).params.aspectRatio).toBe("16:9");
  });

  it("keeps sheets landscape whatever the orientation", () => {
    expect(pickModel("asset_sheet", portrait).params.aspectRatio).toBe("16:9");
  });

  it("separates draft and final video by resolution", () => {
    const draft = pickModel("block_draft", landscape).params;
    const final = pickModel("block_final", landscape).params;
    expect(draft.resolution).not.toBe(final.resolution);
    expect(draft.quality).toBe("draft");
    expect(final.quality).toBe("final");
  });

  it("gives video a clamped duration and a sound flag; images get neither", () => {
    expect(pickModel("block_draft", landscape)).toMatchObject({
      params: { aspectRatio: "16:9", resolution: "480p", durationSeconds: 5, sound: false },
    });
    expect(
      pickModel("block_final", portrait, { durationSeconds: 7.4, sound: true }).params,
    ).toMatchObject({ aspectRatio: "9:16", resolution: "1080p", durationSeconds: 7, sound: true });
    expect(
      pickModel("block_draft", landscape, { durationSeconds: 40 }).params.durationSeconds,
    ).toBe(30);
    expect(pickModel("block_draft", landscape, { durationSeconds: 0 }).params.durationSeconds).toBe(
      1,
    );
    expect(clampDurationSeconds(Number.NaN)).toBe(5);
    const look = pickModel("asset_look", landscape, { durationSeconds: 8, sound: true }).params;
    expect(look.durationSeconds).toBeUndefined();
    expect(look.sound).toBeUndefined();
  });

  it("has a policy for every purpose and returns fresh params", () => {
    for (const purpose of GENERATION_PURPOSES) {
      const choice = pickModel(purpose, landscape);
      expect(choice.model).toMatch(/^[a-z0-9_]+$/);
      choice.params.extra = 1;
      expect(pickModel(purpose, landscape).params.extra).toBeUndefined();
    }
  });
});
