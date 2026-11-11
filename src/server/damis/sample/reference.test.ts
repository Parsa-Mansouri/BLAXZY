import { describe, expect, it } from "vitest";
import type { ProjectStyle } from "@/server/db/schema";
import { assetFixer } from "../asset-fixer/dami";
import { LOOK_ISSUE_CODES } from "../asset-fixer/issues";
import { assetFixerOutputSchema } from "../asset-fixer/schema";
import { assetPromptWriter } from "../asset-prompt-writer/dami";
import { assetPromptWriterOutputSchema } from "../asset-prompt-writer/schema";
import { runDami } from "../framework/runner";
import { sheetFixer } from "../sheet-fixer/dami";
import { SHEET_ISSUE_CODES } from "../sheet-fixer/issues";
import { sheetFixerOutputSchema } from "../sheet-fixer/schema";
import { sheetGenerator } from "../sheet-generator/dami";
import { sheetGeneratorOutputSchema } from "../sheet-generator/schema";
import { testDeps } from "../test-utils";
import { createSampleClaudeClient } from "./client";
import {
  sampleAssetFixer,
  sampleAssetPromptWriter,
  sampleSheetFixer,
  sampleSheetGenerator,
} from "./reference";

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

describe("sample reference generators", () => {
  for (const asset of assets) {
    it(`produce valid output through the runner: ${asset.kind} ${asset.name}`, async () => {
      const d = deps();
      const look = sampleAssetPromptWriter({ style, asset, userPrompt: "Cheerful look." });
      expect(assetPromptWriterOutputSchema.safeParse(look).success).toBe(true);
      const written = await runDami(
        assetPromptWriter,
        { style, asset, userPrompt: "Cheerful look." },
        {},
        d,
      );
      expect(written.output).toEqual(look);

      const sheet = sampleSheetGenerator({ style, asset });
      expect(sheetGeneratorOutputSchema.safeParse(sheet).success).toBe(true);
      expect((await runDami(sheetGenerator, { style, asset }, {}, d)).output).toEqual(sheet);

      const lookFix = await runDami(
        assetFixer,
        {
          style,
          asset,
          previousPrompt: look.prompt,
          review: { issueCodes: ["wrong_age", "background_not_clean"], note: "More smiling." },
        },
        {},
        d,
      );
      expect(lookFix.output.changeSummary.map((c) => c.request)).toEqual([
        "wrong_age",
        "background_not_clean",
        "note",
      ]);

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

  it("folds guided answers and the director's prompt into the look prompt", () => {
    const out = sampleAssetPromptWriter({
      style,
      asset: assets[0],
      userPrompt: "Tired but proud.",
      guidedAnswers: { age: "Older (60s-70s)", hair: "silver braid" },
    });
    expect(out.prompt).toContain("Tired but proud.");
    expect(out.prompt).toContain("Older (60s-70s)");
    expect(out.prompt).toContain("silver braid");
    expect(out.prompt).toContain("2D animation");
    expect(out.notes.join(" ")).toContain("2 guided answers");
  });

  it("works from guided answers alone", () => {
    const out = sampleAssetPromptWriter({
      style,
      asset: assets[2],
      guidedAnswers: { setting: "Interior" },
    });
    expect(assetPromptWriterOutputSchema.safeParse(out).success).toBe(true);
    expect(out.prompt).toContain("Interior");
  });

  it("is deterministic", () => {
    const input = { style, asset: assets[3] };
    expect(sampleSheetGenerator(input)).toEqual(sampleSheetGenerator(input));
  });

  it("makes fixer output visibly reflect every request", () => {
    const previousPrompt = "A reference image of Mara, neutral pose.";
    const look = sampleAssetFixer({
      style,
      asset: assets[0],
      previousPrompt,
      review: { issueCodes: ["text_or_watermark"], note: "Add a blue scarf." },
    });
    expect(assetFixerOutputSchema.safeParse(look).success).toBe(true);
    expect(look.prompt).toContain("A reference image of Mara");
    expect(look.prompt).toContain("no watermark");
    expect(look.prompt).toContain("Add a blue scarf.");
    expect(look.changeSummary).toHaveLength(2);

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
    const previousPrompt = "word ".repeat(1200);
    const look = sampleAssetFixer({
      style,
      asset: assets[0],
      previousPrompt,
      review: { issueCodes: [...LOOK_ISSUE_CODES], note: "n".repeat(500) },
    });
    expect(assetFixerOutputSchema.safeParse(look).success).toBe(true);
    const sheet = sampleSheetFixer({
      style,
      asset: assets[0],
      previousPrompt,
      review: { issueCodes: [...SHEET_ISSUE_CODES], note: "n" },
    });
    expect(sheetFixerOutputSchema.safeParse(sheet).success).toBe(true);
  });
});
