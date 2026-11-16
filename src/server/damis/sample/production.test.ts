import { describe, expect, it } from "vitest";
import type { ProjectStyle } from "@/server/db/schema";
import { blockReviser } from "../block-reviser/dami";
import { BLOCK_ISSUE_CODES } from "../block-reviser/issues";
import { blockReviserOutputSchema } from "../block-reviser/schema";
import { DAMIS } from "../index";
import { takeFixer } from "../take-fixer/dami";
import { TAKE_ISSUE_CODES } from "../take-fixer/issues";
import { takeFixerOutputSchema } from "../take-fixer/schema";
import { SAMPLE_GENERATORS } from "./client";
import { sampleBlockReviser, sampleTakeFixer } from "./production";

const style: ProjectStyle = {
  visualStyle: "2D animation",
  genre: "Comedy",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: 120,
};

describe("sample block-reviser and take-fixer", () => {
  const review = { issueCodes: ["wrong_camera", "tone_off"], note: "Closer on her hands." };

  it("block-reviser reflects every request and passes the check", () => {
    const prompt = "SCENE: Hall <<<image_1>>>. Ines <<<image_2>>> walks in.";
    const input = {
      style,
      block: {
        title: "t",
        scriptExcerpt: "Ines walks in.",
        prompt,
        assetRefs: ["location:Hall", "character:Ines"],
      },
      assets: [
        { ref: "location:Hall", kind: "location", name: "Hall" },
        { ref: "character:Ines", kind: "character", name: "Ines" },
      ],
      review,
    };
    const output = blockReviserOutputSchema.parse(sampleBlockReviser(input));
    expect(blockReviser.check(output, blockReviser.input.parse(input))).toEqual([]);
    expect(output.changeSummary.map((c) => c.request)).toEqual([
      "wrong_camera",
      "tone_off",
      "note",
    ]);
    expect(output.prompt).toContain("Closer on her hands.");
    expect(output.assetRefs).toEqual(["location:Hall", "character:Ines"]);
  });

  it("take-fixer reflects every request and keeps the tokens, for both stages", () => {
    for (const stage of ["draft", "final"] as const) {
      const input = {
        style,
        block: { title: "t", scriptExcerpt: "Ines walks in." },
        previousPrompt: "SCENE: Hall <<<image_1>>>. Ines <<<image_2>>> walks in.",
        assetRefs: ["location:Hall", "character:Ines"],
        stage,
        review: { issueCodes: ["face_distorted"], note: "Slower." },
      };
      const output = takeFixerOutputSchema.parse(sampleTakeFixer(input));
      expect(takeFixer.check(output, takeFixer.input.parse(input))).toEqual([]);
      expect(output.prompt).toContain(`RETRY (${stage})`);
      expect(output.prompt).toContain("Slower.");
      expect(output.changeSummary.map((c) => c.request)).toEqual(["face_distorted", "note"]);
    }
  });

  it("handles every catalogue code", () => {
    const blockInput = {
      style,
      block: {
        title: "t",
        scriptExcerpt: "x",
        prompt: "Ines <<<image_1>>> walks in.",
        assetRefs: ["character:Ines"],
      },
      assets: [{ ref: "character:Ines", kind: "character", name: "Ines" }],
      review: { issueCodes: [...BLOCK_ISSUE_CODES] },
    };
    expect(
      blockReviser.check(
        blockReviserOutputSchema.parse(sampleBlockReviser(blockInput)),
        blockReviser.input.parse(blockInput),
      ),
    ).toEqual([]);
    const takeInput = {
      style,
      block: { title: "t", scriptExcerpt: "x" },
      previousPrompt: "Ines <<<image_1>>> walks in.",
      assetRefs: ["character:Ines"],
      stage: "draft",
      review: { issueCodes: [...TAKE_ISSUE_CODES] },
    };
    expect(
      takeFixer.check(
        takeFixerOutputSchema.parse(sampleTakeFixer(takeInput)),
        takeFixer.input.parse(takeInput),
      ),
    ).toEqual([]);
  });

  it("every registered dami has a sample generator", () => {
    for (const key of Object.keys(DAMIS)) expect(SAMPLE_GENERATORS[key]).toBeTypeOf("function");
  });
});
