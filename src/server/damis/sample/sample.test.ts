import { describe, expect, it } from "vitest";
import type { ProjectStyle } from "@/server/db/schema";
import { assetDetector } from "../asset-detector/dami";
import {
  assetDetectorOutputSchema,
  type AssetDetectorInput,
  type AssetDetectorOutput,
} from "../asset-detector/schema";
import { runDami } from "../framework/runner";
import { sectionScript } from "../prompt-sectioner/section-script";
import { scriptChecker } from "../script-checker/dami";
import { scriptCheckerOutputSchema } from "../script-checker/schema";
import { scriptReviser } from "../script-reviser/dami";
import { scriptReviserModelOutputSchema } from "../script-reviser/schema";
import { scriptWriter } from "../script-writer/dami";
import { writerProject, singleCallTarget } from "../script-writer/project";
import { submitScreenplaySchema } from "../script-writer/schema";
import { renderScreenplay } from "../shared/screenplay";
import { isEpisodeHeading, isSceneHeading, splitLines } from "../shared/script-lines";
import { testDeps } from "../test-utils";
import { createSampleClaudeClient } from "./client";
import { sampleAssetDetector } from "./asset-detector";
import { sampleScriptChecker } from "./script-checker";
import { sampleScriptReviser } from "./script-reviser";
import { sampleScriptWriter } from "./script-writer";

const movie = (seconds: number): ProjectStyle => ({
  visualStyle: "Cinematic live-action",
  genre: "Drama",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: seconds,
});

const series: ProjectStyle = {
  visualStyle: "2D animation",
  genre: "Comedy",
  format: "series",
  orientation: "portrait",
  totalDurationSeconds: 600,
  episodeDurationSeconds: 120,
};

const briefs: Array<{ name: string; style: ProjectStyle; brief: string }> = [
  { name: "one-word brief", style: movie(60), brief: "Lighthouse" },
  {
    name: "brief with names",
    style: movie(180),
    brief: "An old fisherman named Tomas and his granddaughter Leyla find a map in a bottle.",
  },
  {
    name: "non-English brief",
    style: movie(90),
    brief: "یک فانوس‌بان پیر در شبی طوفانی نامه‌ای پیدا می‌کند.",
  },
  { name: "series", style: series, brief: "Two rival bakers share a kitchen in a tiny village." },
  {
    name: "feature length",
    style: movie(90 * 60),
    brief: "A space courier carries a key across the planet.",
  },
  { name: "very short", style: movie(15), brief: "A girl and her umbrella." },
];

const PERSIAN_SCRIPT = [
  "داخلی. آشپزخانه - شب",
  "",
  "مریم پشت میز نشسته است و نامه‌ای را می‌خواند. چراغ نفتی سوسو می‌زند.",
  "",
  "مریم",
  "این نامه را چه کسی آورد؟",
  "",
  "رضا",
  "نمی‌دانم. پشت در بود.",
  "",
  "خارجی. حیاط - سحر",
  "",
  "رضا چمدانی را به سمت در می‌برد.",
].join("\n");

function writerInput(style: ProjectStyle, brief: string) {
  return {
    mode: "generate" as const,
    project: writerProject(style, singleCallTarget(style)),
    story: brief,
  };
}

/** A full detection of an uploaded or rendered script. */
function detectorInput(style: ProjectStyle, content: string): AssetDetectorInput {
  return {
    mode: "full",
    project: {
      format: style.format,
      genre: style.genre,
      style: style.visualStyle,
      era_setting: null,
      ui_language: "en",
      sector: "wizard",
    },
    script: { title: "Sample", logline: "", source: "generated", raw_text: content },
  };
}

/** The detector's entries as the prompt-sectioner's assets (voices named after their owner). */
function sectionerAssets(output: AssetDetectorOutput) {
  const nameOf = new Map(output.characters.map((c) => [c.char_id, c.name]));
  return [
    ...output.characters
      .filter((c) => c.kind !== "voice_only")
      .map((c) => ({
        kind: "character" as const,
        name: c.name,
        description: c.script_description,
      })),
    ...output.locations.map((l) => ({
      kind: "location" as const,
      name: l.name,
      description: l.script_description,
    })),
    ...output.props.map((p) => ({
      kind: "prop" as const,
      name: p.name,
      description: p.script_description,
    })),
    ...output.voices.map((v) => ({
      kind: "voice" as const,
      name: nameOf.get(v.owner_char_id) ?? v.voice_id,
      description: v.ui_summary,
    })),
  ];
}

function sampleDeps() {
  return testDeps(createSampleClaudeClient({ delayMs: 0 })).deps;
}

describe("sample generators", () => {
  for (const { name, style, brief } of briefs) {
    it(`runs the whole chain through the runner: ${name}`, async () => {
      const deps = sampleDeps();
      const raw = sampleScriptWriter(writerInput(style, brief));
      expect(submitScreenplaySchema.safeParse(raw).success).toBe(true);
      // The runner applies the dami's own checks (numbering, per-scene sums).
      const written = await runDami(scriptWriter, writerInput(style, brief), {}, deps);
      expect(written.output).toEqual(raw);
      const content = renderScreenplay({ screenplay: written.output.screenplay }).text;
      const lines = splitLines(content);
      const scenes = lines.filter(isSceneHeading).length;
      expect(scenes).toBe(written.output.screenplay.scenes.length);
      expect(lines.some(isEpisodeHeading)).toBe(false);
      expect(written.output.screenplay.title.length).toBeGreaterThan(0);

      const checked = await runDami(scriptChecker, { style, content }, {}, deps);
      expect(checked.output.issues.length).toBeGreaterThanOrEqual(2);
      expect(checked.output.issues.length).toBeLessThanOrEqual(3);
      expect(
        scriptCheckerOutputSchema.safeParse(sampleScriptChecker({ style, content })).success,
      ).toBe(true);

      const quoteLine = lines.find((l) => l.trim().length > 10 && !isSceneHeading(l)) ?? "";
      const start = content.indexOf(quoteLine);
      const review = {
        issueCodes: ["ending_weak", "pacing_slow"] as const,
        note: "Make it warmer.",
        comments: [{ quote: quoteLine, start, end: start + quoteLine.length, note: "Softer." }],
      };
      const revised = await runDami(
        scriptReviser,
        { style, content, review: { ...review, issueCodes: [...review.issueCodes] } },
        {},
        deps,
      );
      expect(revised.output.content).not.toEqual(content);
      expect(revised.output.changeSummary.map((c) => c.request).sort()).toEqual(
        ["comment 1", "ending_weak", "note", "pacing_slow"].sort(),
      );
      expect(revised.output.content).toContain("(softer)");

      const detected = await runDami(assetDetector, detectorInput(style, content), {}, deps);
      const assets = sectionerAssets(detected.output);
      const kinds = new Set(assets.map((a) => a.kind));
      expect(kinds).toContain("character");
      expect(kinds).toContain("location");
      expect(kinds).toContain("prop");
      expect(kinds).toContain("voice");
      const characters = detected.output.characters;
      expect(characters.length).toBeGreaterThanOrEqual(style.totalDurationSeconds < 30 ? 1 : 2);
      expect(characters.length).toBeLessThanOrEqual(3);
      expect(detected.output.scene_index.length).toBe(scenes);

      const sectioned = await sectionScript({ style, content, assets }, {}, deps);
      expect(sectioned.blocks.length).toBeGreaterThan(0);
      expect(sectioned.blocks.some((b) => b.assetRefs.length > 0)).toBe(true);
    });
  }

  it("is deterministic for a given input", () => {
    const input = writerInput(movie(120), "A night train and a stolen photograph.");
    expect(sampleScriptWriter(input)).toEqual(sampleScriptWriter(input));
  });

  it("handles a non-English script in every reading dami", async () => {
    const deps = sampleDeps();
    const style = movie(60);
    const content = PERSIAN_SCRIPT;
    const checked = sampleScriptChecker({ style, content });
    expect(scriptCheckerOutputSchema.safeParse(checked).success).toBe(true);
    await runDami(scriptChecker, { style, content }, {}, deps);

    const detected = sampleAssetDetector(detectorInput(style, content));
    expect(assetDetectorOutputSchema.safeParse(detected).success).toBe(true);
    expect(detected.characters.map((c) => c.name)).toEqual(["مریم", "رضا"]);
    expect(detected.locations).toHaveLength(2);
    const run = await runDami(assetDetector, detectorInput(style, content), {}, deps);

    const review = {
      issueCodes: [],
      note: "",
      comments: [{ quote: "نمی‌دانم. پشت در بود.", start: 0, end: 5, note: "گرم‌تر" }],
    };
    const revised = sampleScriptReviser({ style, content, review });
    expect(scriptReviserModelOutputSchema.safeParse(revised).success).toBe(true);
    await runDami(scriptReviser, { style, content, review }, {}, deps);

    const sectioned = await sectionScript(
      { style, content, assets: sectionerAssets(run.output) },
      {},
      deps,
    );
    expect(sectioned.blocks.length).toBeGreaterThan(0);
  });

  it("keeps the ids of known assets (matching names ignoring case)", async () => {
    const style = movie(60);
    const content = renderScreenplay({
      screenplay: sampleScriptWriter(writerInput(style, "Lighthouse")).screenplay,
    }).text;
    const first = sampleAssetDetector(detectorInput(style, content));
    const character = first.characters[0];
    if (!character) throw new Error("no character detected");
    const input: AssetDetectorInput = {
      ...detectorInput(style, content),
      mode: "incremental",
      known_assets: [
        {
          id: "char_4",
          status: "approved",
          entry: { name: character.name.toUpperCase(), aliases: [] },
        },
      ],
    };
    const again = await runDami(assetDetector, input, {}, sampleDeps());
    const kept = again.output.characters.find((c) => c.char_id === "char_4");
    expect(kept?.name).toBe(character.name.toUpperCase());
    expect(again.output.characters.map((c) => c.char_id)).not.toContain("char_1");
    expect(again.output.diff.added.filter((id) => id.startsWith("char_"))).toEqual(
      again.output.characters.filter((c) => c.char_id !== "char_4").map((c) => c.char_id),
    );
  });

  it("records model sample and no cost in sample mode", async () => {
    const { deps, store } = testDeps(createSampleClaudeClient({ delayMs: 0 }), {
      client: undefined,
      config: {
        apiKey: undefined,
        defaultModel: undefined,
        maxConcurrency: 2,
        maxRetries: 0,
        mode: "sample",
        sampleDelayMs: 0,
      },
    });
    const result = await runDami(scriptWriter, writerInput(movie(60), "Lighthouse"), {}, deps);
    expect(result.model).toBe("sample");
    expect(result.costUsd).toBeNull();
    expect(store.runs[0]?.model).toBe("sample");
  });
});
