import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAUDE_MODELS } from "../framework/models";
import { runDami } from "../framework/runner";
import {
  LOCATION_GENRE_LENSES,
  LOCATION_ORIENTATION_SYSTEM,
  LOCATION_STYLE_LENSES,
} from "../location-shared/modules";
import { createSampleClaudeClient } from "../sample/client";
import { sampleLocationGenerator } from "../sample/location-generator";
import { designerInputText } from "../shared/designer";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { checkLocationSpec, locationGenerator } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { LOCATION_GENERATOR_CORE } from "./prompt";
import { locationQuestions } from "./questions";
import { locationGeneratorInputSchema, locationGeneratorOutputSchema } from "./schema";

const withImages = <D extends object>(deps: D) => ({
  ...deps,
  resolveImage: () => Promise.resolve({ mediaType: "image/png" as const, data: "AA==" }),
});
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const read = (path: string) => lf(readFileSync(new URL(path, import.meta.url), "utf8"));
const input = locationGeneratorInputSchema.parse(inputJson);
const output = locationGeneratorOutputSchema.parse(outputJson);
const sampleDeps = () => withImages(testDeps(createSampleClaudeClient({ delayMs: 0 })).deps);

describe("location-generator", () => {
  it("keeps the core prompt and every shared module verbatim from the owner's files", () => {
    const source = read("./source/location_generator_dami_v1.md");
    expect(source.includes(lf(LOCATION_GENERATOR_CORE))).toBe(true);
    const shared = read("../location-shared/source/location_shared_modules_v1.md");
    const blocks = [
      LOCATION_ORIENTATION_SYSTEM,
      ...Object.values(LOCATION_GENRE_LENSES),
      ...Object.values(LOCATION_STYLE_LENSES),
    ];
    expect(blocks).toHaveLength(14);
    for (const block of blocks) expect(shared.includes(lf(block))).toBe(true);
  });

  it("assembles CORE + ORIENTATION + the project's genre and style lens only", () => {
    const prompt = locationGenerator.build(input);
    const system = prompt.system.map((p) => p.text).join("\n");
    expect(system).toContain(LOCATION_ORIENTATION_SYSTEM);
    expect(system).toContain(`<genre_lens>\n${LOCATION_GENRE_LENSES.Thriller}\n</genre_lens>`);
    expect(system).toContain(`<style_lens>\n${LOCATION_STYLE_LENSES.Noir}\n</style_lens>`);
    expect(system).not.toContain(LOCATION_GENRE_LENSES.Comedy);
    expect(prompt.system.filter((p) => p.cache).length).toBeLessThanOrEqual(4);
    const text = designerInputText(prompt);
    expect(text.startsWith("<input>\n")).toBe(true);
    const json = JSON.parse(text.slice("<input>\n".length, -"\n</input>".length)) as Record<
      string,
      unknown
    >;
    expect(json).toMatchObject({
      output_mode: "lock",
      exclude_assets: ["Mara", "Jonas", "brass locket"],
      guided_answers: { light_atmosphere: "ai_decides" },
      location: { name: "Ferry Cabin", interior_exterior: "interior" },
    });
    // A typed genre or style has no lens.
    const typed = locationGenerator.build({
      ...input,
      project: { ...input.project, genre: "Mumblecore", style: "Watercolour" },
    });
    expect(typed.system).toHaveLength(1);
  });

  it("fixture output passes the owner's validators; runs on Sonnet", async () => {
    expect(checkLocationSpec(output, input)).toEqual([]);
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(locationGenerator, input, {}, testDeps(client).deps);
    expect(result.output).toEqual(output);
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.sonnet);
  });

  it("flags anchors missing from the DNA, a wrong coverage mode and unapplied fixes", () => {
    const badHero = {
      ...output,
      hero_wide: { ...output.hero_wide, visible_anchor_ids: ["ghost"] },
    };
    expect(checkLocationSpec(badHero, input).join(" ")).toContain("ghost");
    const concept = {
      ...output,
      coverage_plan: { ...output.coverage_plan, mode: "concept" as const },
    };
    expect(checkLocationSpec(concept, input)).not.toEqual([]);
    const fix = {
      ...input,
      previousOutput: outputJson,
      fixRequests: [{ type: "technical" as const, code: "LT01", instruction: "Empty." }],
    };
    expect(checkLocationSpec(output, fix).join(" ")).toContain("LT01");
  });

  it("sample mode: an uploaded Hero is used as is; a fix keeps ids and applies the codes", async () => {
    const deps = sampleDeps();
    const hero = await runDami(
      locationGenerator,
      {
        ...input,
        referenceImages: [{ fileId: "00000000-0000-4000-8000-000000000201", role: "hero" }],
      },
      {},
      deps,
    );
    expect(hero.output.hero_wide.mode).toBe("use_uploaded");
    expect(hero.output.hero_wide.image_prompt).toBe("");
    const first = sampleLocationGenerator(inputJson);
    const fixed = await runDami(
      locationGenerator,
      {
        ...input,
        previousOutput: first,
        fixRequests: [{ type: "technical", code: "LT07", instruction: "Place every opening." }],
      },
      {},
      deps,
    );
    expect(fixed.output.applied_fixes).toEqual(["LT07"]);
    expect(fixed.output.dna.fixed_anchors).toEqual(first.dna.fixed_anchors);
    // Without the script slice it still designs, with a warning.
    const bare = await runDami(locationGenerator, { ...input, scriptContext: undefined }, {}, deps);
    expect(bare.output.warnings.length).toBeGreaterThan(0);
    const exterior = await runDami(
      locationGenerator,
      {
        ...input,
        location: { ...input.location, interiorExterior: "exterior" },
        outputMode: "concept",
      },
      {},
      deps,
    );
    expect(exterior.output.coverage_plan.views.map((v) => v.view_id)).toContain(
      "establishing_wide",
    );
  });

  it("skips what the script and project answer; always asks shape, materials and light", () => {
    const ask = (details: Record<string, unknown>, description: string | null, era?: string) =>
      locationQuestions({
        asset: { name: "Ferry Cabin", description, details },
        project: { ...(era ? { eraSetting: era } : {}), genre: "drama", visualStyle: "noir" },
      }).map((q) => q.id);
    expect(ask({}, null)).toEqual([
      "what_is_it",
      "interior_exterior",
      "narrative_function",
      "era_world",
      "shape_size",
      "fixed_elements",
      "materials_colors",
      "light_atmosphere",
    ]);
    expect(
      ask({ interiorExterior: "interior", sceneRefs: ["1"] }, "A cabin.", "1970s Baltic"),
    ).toEqual(["shape_size", "fixed_elements", "materials_colors", "light_atmosphere"]);
    const light = locationQuestions({
      asset: { name: "x", description: "x", details: { timeOfDay: "night" } },
      project: {},
    }).find((q) => q.id === "light_atmosphere");
    expect(light?.prefill).toBe("Night, lamps and street light");
  });
});
