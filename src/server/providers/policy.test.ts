import { describe, expect, it } from "vitest";
import { GENERATION_PURPOSES, type ProjectStyle } from "@/server/db/schema";
import { MODEL_POLICY, pickModel } from "@/server/providers/policy";

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

  it("has a policy for every purpose and returns fresh params", () => {
    for (const purpose of GENERATION_PURPOSES) {
      const choice = pickModel(purpose, landscape);
      expect(choice.model).toMatch(/^[a-z0-9_]+$/);
      choice.params.extra = 1;
      expect(pickModel(purpose, landscape).params.extra).toBeUndefined();
    }
  });
});
