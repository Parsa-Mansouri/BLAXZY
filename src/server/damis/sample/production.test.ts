import { describe, expect, it } from "vitest";
import type { ProjectStyle } from "@/server/db/schema";
import { DAMIS } from "../index";
import { takeFixer } from "../take-fixer/dami";
import { TAKE_ISSUE_CODES } from "../take-fixer/issues";
import { takeFixerOutputSchema } from "../take-fixer/schema";
import { SAMPLE_GENERATORS } from "./client";
import { sampleTakeFixer } from "./production";

const style: ProjectStyle = {
  visualStyle: "2D animation",
  genre: "Comedy",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: 120,
};

describe("sample take-fixer", () => {
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
