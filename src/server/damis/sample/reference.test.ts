import { describe, expect, it } from "vitest";
import type { ProjectStyle } from "@/server/db/schema";
import { runDami } from "../framework/runner";
import { sheetFixer } from "../sheet-fixer/dami";
import { SHEET_ISSUE_CODES } from "../sheet-fixer/issues";
import { sheetFixerOutputSchema } from "../sheet-fixer/schema";
import { sheetGenerator } from "../sheet-generator/dami";
import { sheetGeneratorOutputSchema } from "../sheet-generator/schema";
import { testDeps } from "../test-utils";
import { createSampleClaudeClient } from "./client";
import { sampleSheetFixer, sampleSheetGenerator } from "./reference";

const style: ProjectStyle = {
  visualStyle: "2D animation",
  genre: "Comedy",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: 120,
};

const assets = [
  { kind: "character", name: "Mara", description: "Woman in her 60s with a grey braid." },
  { kind: "character", name: "مریم", description: "پیرزنی با روسری آبی" },
  { kind: "location", name: "Café Müller", description: "" },
  { kind: "prop", name: "Brass locket", description: "Small, tarnished." },
  { kind: "creature", name: "鳳凰", description: "A red-gold bird." },
  { kind: "costume", name: "Wedding dress", description: "Ivory silk." },
  { kind: "other", name: "Lantern fleet", description: "Many paper lanterns." },
] as const;

function deps() {
  return testDeps(createSampleClaudeClient({ delayMs: 0 })).deps;
}

describe("sample sheet generators", () => {
  for (const asset of assets) {
    it(`produce valid output through the runner: ${asset.kind} ${asset.name}`, async () => {
      const d = deps();
      const sheet = sampleSheetGenerator({ style, asset });
      expect(sheetGeneratorOutputSchema.safeParse(sheet).success).toBe(true);
      expect((await runDami(sheetGenerator, { style, asset }, {}, d)).output).toEqual(sheet);

      const sheetFix = await runDami(
        sheetFixer,
        {
          style,
          asset,
          previousPrompt: sheet.prompt,
          review: { issueCodes: ["missing_view"] },
        },
        {},
        d,
      );
      expect(sheetFix.output.changeSummary.map((c) => c.request)).toEqual(["missing_view"]);
    });
  }

  it("is deterministic", () => {
    const input = { style, asset: assets[3] };
    expect(sampleSheetGenerator(input)).toEqual(sampleSheetGenerator(input));
  });

  it("makes fixer output visibly reflect every request", () => {
    const previousPrompt = "A reference sheet of Mara, four views.";
    const sheet = sampleSheetFixer({
      style,
      asset: assets[0],
      previousPrompt,
      review: { issueCodes: ["inconsistent_views", "layout_cluttered"] },
    });
    expect(sheetFixerOutputSchema.safeParse(sheet).success).toBe(true);
    expect(sheet.prompt).toContain("same subject as the attached image");
    expect(sheet.changeSummary.map((c) => c.request)).toEqual([
      "inconsistent_views",
      "layout_cluttered",
    ]);
  });

  it("handles every issue code and very long previous prompts", () => {
    const sheet = sampleSheetFixer({
      style,
      asset: assets[0],
      previousPrompt: "word ".repeat(1200),
      review: { issueCodes: [...SHEET_ISSUE_CODES], note: "n" },
    });
    expect(sheetFixerOutputSchema.safeParse(sheet).success).toBe(true);
  });
});
