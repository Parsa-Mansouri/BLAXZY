import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { GENRES, LEGACY_GENRE_KEYS, LEGACY_STYLE_KEYS, VISUAL_STYLES } from "@/lib/style-options";
import type { ProjectStyle } from "@/server/db/schema";
import { countBreakpoints, outputFormatFor } from "../framework/request";
import { CLAUDE_MODELS } from "../framework/models";
import { runDami } from "../framework/runner";
import { PLATFORM_CONFIG, speechRateWps } from "../shared/platform";
import { sampleCreativeDna } from "../sample/creative-dna";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { checkCreativeBible, creativeDna } from "./dami";
import rawInputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { creativeBibleKey, creativeDnaInputFromStyle } from "./input";
import { buildCreativeDnaPrompt } from "./prompt";
import { CREATIVE_DNA_SYSTEM } from "./prompt-text";
import {
  CREATIVE_REGISTRY,
  getCreativeModule,
  MAPPED_GENRE_KEYS,
  MAPPED_STYLE_KEYS,
  registryIdsForStyle,
} from "./registry";
import { creativeBibleSchema, creativeDnaInputSchema, REVIEW_POINTS } from "./schema";
import ownerTests from "./source/creative_dna.tests.json";
import ownerSchema from "./source/output_10.schema.json";

const SOURCE = join(__dirname, "source");
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const inputJson = rawInputJson as z.input<typeof creativeDnaInputSchema>;
const input = creativeDnaInputSchema.parse(inputJson);
const bible = creativeBibleSchema.parse(outputJson);

function style(overrides: Partial<ProjectStyle> = {}): ProjectStyle {
  return {
    visualStyle: "realistic",
    genre: "drama",
    format: "movie",
    orientation: "portrait",
    totalDurationSeconds: 60,
    ...overrides,
  };
}

describe("creative-dna source", () => {
  const sourceMd = lf(readFileSync(join(SOURCE, "dami_00_creative_dna.system.md"), "utf8"));

  it("the system prompt is the owner's file from <role> to the end", () => {
    expect(CREATIVE_DNA_SYSTEM).toBe(sourceMd.slice(sourceMd.indexOf("<role>")).trimEnd());
    // The four header lines above <role> are metadata and stay out of the prompt.
    const header = sourceMd.slice(0, sourceMd.indexOf("<role>")).trim().split("\n");
    expect(header.filter((l) => l.startsWith("#"))).toHaveLength(4);
    expect(CREATIVE_DNA_SYSTEM).not.toContain("DAMI-00");
  });

  it("the registry in code is the owner's registry file", () => {
    const file: unknown = JSON.parse(
      readFileSync(join(SOURCE, "creative_modules_registry.v1.json"), "utf8"),
    );
    expect(file).toEqual(CREATIVE_REGISTRY);
    expect(CREATIVE_REGISTRY.modules).toHaveLength(13);
    expect(CREATIVE_REGISTRY.modules.filter((m) => m.kind === "genre")).toHaveLength(6);
    expect(CREATIVE_REGISTRY.modules.filter((m) => m.kind === "style")).toHaveLength(7);
  });

  it("the output schema mirrors output_10 (required keys, enums, id pattern)", () => {
    const sent = outputFormatFor(creativeBibleSchema).schema as {
      required?: string[];
    };
    expect([...(sent.required ?? [])].sort()).toEqual([...ownerSchema.required].sort());
    expect(JSON.stringify(sent)).toContain(
      JSON.stringify(ownerSchema.properties.validation_status.enum),
    );
    expect(ownerSchema.$defs.Rule.properties.id.pattern).toBe("^[a-z0-9_]+$");
    expect(ownerSchema.properties.open_questions.maxItems).toBe(2);
  });

  it("the structured-output schema is closed: no free-form objects anywhere", () => {
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== "object" || node === null) return;
      const obj = node as Record<string, unknown>;
      if (obj.type === "object") expect(obj.additionalProperties).toBe(false);
      Object.values(obj).forEach(walk);
    };
    walk(outputFormatFor(creativeBibleSchema).schema);
  });
});

describe("registryIdsForStyle", () => {
  it("maps every Style-screen genre and style to a registry module of the right kind", () => {
    expect([...MAPPED_GENRE_KEYS]).toEqual(GENRES.map((o) => o.value));
    expect([...MAPPED_STYLE_KEYS]).toEqual(VISUAL_STYLES.map((o) => o.value));
    for (const g of GENRES) {
      for (const s of VISUAL_STYLES) {
        const ids = registryIdsForStyle(style({ genre: g.value, visualStyle: s.value }));
        expect(ids, `${g.value} + ${s.value}`).not.toBeNull();
        expect(getCreativeModule(ids?.genreId ?? "").kind).toBe("genre");
        expect(getCreativeModule(ids?.styleId ?? "").kind).toBe("style");
      }
    }
  });

  it("uses the registry's spelling for the hyphenated keys", () => {
    expect(registryIdsForStyle(style({ genre: "sci-fi", visualStyle: "horror-visual" }))).toEqual({
      genreId: "genre.sci_fi",
      styleId: "style.horror_visual",
    });
    expect(registryIdsForStyle(style({ visualStyle: "3d-animation" }))?.styleId).toBe(
      "style.animation_3d",
    );
  });

  it("maps the legacy keys through the existing legacy maps", () => {
    for (const [legacy, current] of Object.entries(LEGACY_STYLE_KEYS)) {
      expect(registryIdsForStyle(style({ visualStyle: legacy }))).toEqual(
        registryIdsForStyle(style({ visualStyle: current })),
      );
    }
    for (const [legacy, current] of Object.entries(LEGACY_GENRE_KEYS)) {
      expect(registryIdsForStyle(style({ genre: legacy }))).toEqual(
        registryIdsForStyle(style({ genre: current })),
      );
    }
  });

  it("returns null for a typed Other genre or style (and for keys of the object prototype)", () => {
    expect(registryIdsForStyle(style({ genre: "Mumblecore comedy" }))).toBeNull();
    expect(registryIdsForStyle(style({ visualStyle: "Pixar-ish felt" }))).toBeNull();
    expect(registryIdsForStyle(style({ genre: "constructor" }))).toBeNull();
    expect(registryIdsForStyle(style({ visualStyle: "toString" }))).toBeNull();
  });
});

describe("creativeDnaInputFromStyle", () => {
  it("a movie is one episode as long as the film", () => {
    expect(creativeDnaInputFromStyle(style({ totalDurationSeconds: 90 }))).toEqual({
      genre_id: "genre.drama",
      style_id: "style.realistic",
      format: "film",
      episode_count: null,
      episode_duration_sec: 90,
      total_duration_sec: 90,
      orientation: "portrait",
      ui_language: "en",
    });
  });

  it("a series carries its episode count, audience and language", () => {
    const result = creativeDnaInputFromStyle(
      style({
        format: "series",
        totalDurationSeconds: 540,
        episodeDurationSeconds: 90,
        audienceRating: "PG-13",
        extras: { language: "fa" },
      }),
    );
    expect(result).toMatchObject({
      format: "series",
      episode_count: 6,
      episode_duration_sec: 90,
      total_duration_sec: 540,
      audience: "PG-13",
      script_language: "fa",
    });
    expect(creativeDnaInputSchema.safeParse(result).success).toBe(true);
  });

  it("carries the chosen block length (15 or 30) and makes it binding", () => {
    for (const [choice, sec] of [
      ["15", 15],
      ["30", 30],
    ] as const) {
      const result = creativeDnaInputFromStyle(style({ blockLength: choice }));
      expect(result).toMatchObject({ block_length_sec: sec });
      expect(creativeDnaInputSchema.safeParse(result).success).toBe(true);
      const parsed = creativeDnaInputSchema.parse(result);
      const text = JSON.stringify(buildCreativeDnaPrompt(parsed));
      expect(text).toContain(`The user chose ${sec}-second blocks`);
      // The sample bible follows the choice, and a bible that ignores it fails the check.
      const bible = sampleCreativeDna(parsed);
      expect(bible.project_frame.block_length_sec).toBe(sec);
      expect(checkCreativeBible(bible, parsed)).toEqual([]);
      const other = sec === 15 ? 30 : 15;
      const wrong = structuredClone(bible);
      wrong.project_frame.block_length_sec = other;
      wrong.project_frame.blocks_per_episode = Math.ceil(parsed.episode_duration_sec! / other);
      expect(checkCreativeBible(wrong, parsed).join(" ")).toContain("the user chose");
    }
  });

  it("leaves the block length out for shot by shot or unset, and the key changes with it", () => {
    expect(creativeDnaInputFromStyle(style({ blockLength: "shot" }))).not.toHaveProperty(
      "block_length_sec",
    );
    expect(creativeDnaInputFromStyle(style())).not.toHaveProperty("block_length_sec");
    const base = creativeBibleKey(style());
    expect(creativeBibleKey(style({ blockLength: "shot" }))).toBe(base);
    expect(creativeBibleKey(style({ blockLength: "30" }))).not.toBe(base);
  });

  it("is null for Other, and the key ignores what a bible does not depend on", () => {
    expect(creativeDnaInputFromStyle(style({ genre: "Other thing" }))).toBeNull();
    expect(creativeBibleKey(style({ genre: "Other thing" }))).toBeNull();
    const base = creativeBibleKey(style());
    expect(creativeBibleKey(style({ lookLine: "a look", styleDescriptor: "desc" }))).toBe(base);
    expect(creativeBibleKey(style({ genre: "comedy" }))).not.toBe(base);
    expect(creativeBibleKey(style({ orientation: "landscape" }))).not.toBe(base);
    expect(creativeBibleKey(style({ totalDurationSeconds: 61 }))).not.toBe(base);
  });
});

describe("creative-dna input guard (owner case t10)", () => {
  it("refuses a style module as the genre, a genre module as the style and unknown ids", () => {
    expect(creativeDnaInputSchema.safeParse({ ...inputJson, genre_id: "style.noir" }).success).toBe(
      false,
    );
    expect(
      creativeDnaInputSchema.safeParse({ ...inputJson, style_id: "genre.drama" }).success,
    ).toBe(false);
    expect(creativeDnaInputSchema.safeParse({ ...inputJson, genre_id: "genre.nope" }).success).toBe(
      false,
    );
  });

  it("stops before any Claude call", async () => {
    const client = new FakeClaudeClient([]);
    await expect(
      runDami(creativeDna, { ...inputJson, genre_id: "style.noir" }, {}, testDeps(client).deps),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(client.requests).toHaveLength(0);
  });
});

describe("creative-dna output schema", () => {
  it("the fixture is a valid bible and passes the semantic checks", () => {
    expect(checkCreativeBible(bible, input)).toEqual([]);
  });

  it("enforces the owner's counts for a bible that is not rejected", () => {
    const fewRules = structuredClone(outputJson);
    fewRules.slices.for_director.rules = fewRules.slices.for_director.rules.slice(0, 2);
    expect(creativeBibleSchema.safeParse(fewRules).success).toBe(false);

    const fewGuards = structuredClone(outputJson);
    fewGuards.anti_cliche_guards = fewGuards.anti_cliche_guards.slice(0, 3);
    expect(creativeBibleSchema.safeParse(fewGuards).success).toBe(false);

    const fewQc = structuredClone(outputJson);
    fewQc.qc_checklist = fewQc.qc_checklist.slice(0, 11);
    expect(creativeBibleSchema.safeParse(fewQc).success).toBe(false);

    const fewOptions = structuredClone(outputJson);
    fewOptions.review_options.video.preference = fewOptions.review_options.video.preference.slice(
      0,
      3,
    );
    expect(creativeBibleSchema.safeParse(fewOptions).success).toBe(false);

    const manyOptions = structuredClone(outputJson);
    const extra = manyOptions.review_options.script.technical[0];
    manyOptions.review_options.script.technical.push(
      ...[1, 2, 3, 4].map((n) => ({ ...extra, id: `extra_${n}` })),
    );
    expect(creativeBibleSchema.safeParse(manyOptions).success).toBe(false);
  });

  it("rejects bad ids, selection prefixes, a third open question and a bad enum", () => {
    const badId = structuredClone(outputJson);
    badId.slices.for_director.rules[0].id = "Bad Id";
    expect(creativeBibleSchema.safeParse(badId).success).toBe(false);

    const badSelection = structuredClone(outputJson);
    badSelection.selection.genre_id = "style.noir";
    expect(creativeBibleSchema.safeParse(badSelection).success).toBe(false);

    const question = {
      id: "q",
      question: "?",
      options: ["a", "b"],
      provisional_default: "a",
      affects: [],
    };
    const three = {
      ...structuredClone(outputJson),
      open_questions: [question, question, question],
    };
    expect(creativeBibleSchema.safeParse(three).success).toBe(false);
    const oneOption = {
      ...structuredClone(outputJson),
      open_questions: [{ ...question, options: ["a"] }],
    };
    expect(creativeBibleSchema.safeParse(oneOption).success).toBe(false);

    const badEnum = structuredClone(outputJson) as { validation_status: string };
    badEnum.validation_status = "fine";
    expect(creativeBibleSchema.safeParse(badEnum).success).toBe(false);
  });

  it("accepts the owner's minimal skeleton for a rejected selection", () => {
    const empty = { rules: [] };
    const point = { technical: [], preference: [] };
    const skeleton = {
      dami: "creative_dna",
      dami_version: "1.0",
      registry_version: "1.0",
      selection: { genre_id: "genre.drama", style_id: "style.anime" },
      project_frame: {
        format: "unknown",
        episode_count: null,
        episode_duration_sec: null,
        total_duration_sec: null,
        orientation: "unknown",
        audience: null,
        script_language: null,
        ui_language: null,
        dialogue_policy: null,
        block_length_sec: 15,
        blocks_per_episode: null,
        max_spoken_words_per_block: null,
      },
      contracts: { genre_contract: "", style_contract: "", combination_logic: "" },
      slices: {
        for_script_writer: { rules: [], beat_guidance: [], series_rules: [] },
        for_script_checker: empty,
        for_asset_detector: { rules: [], attributes_to_capture: [] },
        for_asset_generation: { rules: [], guided_question_focus: [] },
        for_sheet_generator: { rules: [], locks_to_capture: [] },
        for_director: empty,
        for_text_blocks_video: empty,
      },
      continuity_locks: [],
      anti_cliche_guards: [],
      qc_checklist: [],
      review_options: {
        script: point,
        asset: point,
        sheet: point,
        text_block: point,
        video: point,
      },
      conflicts: [
        {
          type: "selection",
          description: "genre_module.kind is not genre",
          resolution: "Rejected.",
          needs_user_decision: false,
        },
      ],
      open_questions: [],
      assumptions: [],
      validation_status: "rejected",
    };
    const parsed = creativeBibleSchema.parse(skeleton);
    // A rejected answer is not checked further, but it must explain itself.
    expect(checkCreativeBible(parsed, input)).toEqual([]);
    expect(checkCreativeBible({ ...parsed, conflicts: [] }, input)).toHaveLength(1);
    // The same skeleton marked ok is not a bible.
    expect(creativeBibleSchema.safeParse({ ...skeleton, validation_status: "ok" }).success).toBe(
      false,
    );
  });
});

describe("creative-dna check()", () => {
  it("flags selection ids that do not match the request", () => {
    const wrong = structuredClone(bible);
    wrong.selection.style_id = "style.noir";
    expect(checkCreativeBible(wrong, input).join("\n")).toContain("selection ids");
  });

  it("needs all six genre and six style criteria", () => {
    const missing = structuredClone(bible);
    const drop = missing.qc_checklist.findIndex(
      (q) => q.type === "criterion" && q.source === "genre",
    );
    missing.qc_checklist.splice(drop, 1, {
      ...missing.qc_checklist[drop],
      type: "boundary_test",
    });
    expect(checkCreativeBible(missing, input).join("\n")).toContain("6 genre criteria");
  });

  it("flags ids repeated across the slice rules and the review options", () => {
    const rules = structuredClone(bible);
    rules.slices.for_director.rules[1].id = rules.slices.for_script_writer.rules[0].id;
    expect(checkCreativeBible(rules, input).join("\n")).toContain("duplicate id");

    const options = structuredClone(bible);
    options.review_options.video.technical[0].id = options.review_options.script.technical[0].id;
    expect(checkCreativeBible(options, input).join("\n")).toContain("duplicate id");

    const series = structuredClone(bible);
    series.slices.for_script_writer.series_rules = [{ ...series.slices.for_director.rules[0] }];
    expect(checkCreativeBible(series, input).join("\n")).toContain("duplicate id");
  });

  it("dialogue_policy none requires max_spoken_words_per_block 0", () => {
    const none = { ...input, dialogue_policy: "none" as const };
    expect(checkCreativeBible(bible, none).join("\n")).toContain("max_spoken_words_per_block = 0");
    const silent = structuredClone(bible);
    silent.project_frame.max_spoken_words_per_block = 0;
    expect(checkCreativeBible(silent, none)).toEqual([]);
  });

  it("checks the block math against the platform's block lengths", () => {
    const wrongBlocks = structuredClone(bible);
    wrongBlocks.project_frame.blocks_per_episode = 3;
    expect(checkCreativeBible(wrongBlocks, input).join("\n")).toContain("= 4");
    const wrongLength = structuredClone(bible);
    wrongLength.project_frame.block_length_sec = 20;
    expect(checkCreativeBible(wrongLength, input).join("\n")).toContain("block_length_sec");
  });
});

describe("creative-dna prompt", () => {
  it("caches the system prompt and the modules, and sends the settings last", () => {
    const prompt = buildCreativeDnaPrompt(input);
    expect(prompt.system).toEqual([{ text: CREATIVE_DNA_SYSTEM, cache: true }]);
    expect(countBreakpoints(prompt)).toBe(2);
    expect(prompt.messages).toHaveLength(1);
    const [stable, perProject] = prompt.messages[0]?.content ?? [];
    expect(stable).toMatchObject({ cache: true });
    expect(perProject).not.toHaveProperty("cache");
    const text = (part: unknown) => (part as { text: string }).text;
    expect(text(stable)).toBe(
      [
        `<shared_core>\n${CREATIVE_REGISTRY.shared_core_en}\n</shared_core>`,
        `<genre_module>\n${JSON.stringify(getCreativeModule("genre.drama"))}\n</genre_module>`,
        `<style_module>\n${JSON.stringify(getCreativeModule("style.realistic"))}\n</style_module>`,
      ].join("\n\n"),
    );
    const { genre_id, style_id, ...settings } = input;
    void genre_id;
    void style_id;
    expect(text(perProject)).toBe(
      [
        `<project_settings>\n${JSON.stringify(settings)}\n</project_settings>`,
        `<platform_config>\n${JSON.stringify(PLATFORM_CONFIG)}\n</platform_config>`,
        "Compile output_10 now. Return only the JSON object.",
      ].join("\n\n"),
    );
    expect(text(perProject)).not.toContain("genre.drama");
  });

  it("uses the owner's platform numbers", () => {
    expect(PLATFORM_CONFIG).toEqual({
      block_length_options_sec: [15, 30],
      default_block_length_sec: 15,
      speech_rate_wps: { en: 2.5, fa: 2.0, tr: 2.0, default: 2.2 },
      max_events_per_block: { "15": 2, "30": 4 },
    });
    expect(speechRateWps("fa")).toBe(2);
    expect(speechRateWps("en-US")).toBe(2.5);
    expect(speechRateWps("de")).toBe(2.2);
    expect(speechRateWps(null)).toBe(2.2);
  });
});

describe("creative-dna run", () => {
  it("runs end to end with a fake client on Opus", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(creativeDna, inputJson, {}, testDeps(client).deps);
    expect(result.output).toEqual(bible);
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.opus);
    expect(creativeDna.version).toBe("1.0.0");
  });

  it("sends the failed checks back once, then accepts the corrected bible", async () => {
    const wrong = structuredClone(outputJson);
    wrong.project_frame.blocks_per_episode = 2;
    const client = new FakeClaudeClient([jsonResponse(wrong), jsonResponse(outputJson)]);
    const result = await runDami(creativeDna, inputJson, {}, testDeps(client).deps);
    expect(client.requests).toHaveLength(2);
    expect(result.output.project_frame.blocks_per_episode).toBe(4);
  });
});

/** The owner's regression set, run against the sample generator and the checks. */
describe("owner regression cases (creative_dna.tests.json)", () => {
  const cases = ownerTests.cases;
  const byId = (id: string) => {
    const found = cases.find((c) => c.id === id);
    if (!found) throw new Error(`no case ${id}`);
    return found.settings;
  };

  it("has the ten cases", () => {
    expect(cases.map((c) => c.id)).toHaveLength(10);
  });

  it("every case but t10 compiles to a valid bible that passes the checks", () => {
    for (const c of cases.filter((c) => c.id !== "t10_wrong_kind")) {
      const parsed = creativeDnaInputSchema.parse(c.settings);
      const out = sampleCreativeDna(c.settings);
      expect(creativeBibleSchema.safeParse(out).success, c.id).toBe(true);
      expect(checkCreativeBible(out, parsed), c.id).toEqual([]);
      expect(out.selection, c.id).toEqual({
        genre_id: c.settings.genre_id,
        style_id: c.settings.style_id,
      });
    }
  });

  it("t01: a 60 s portrait film is 4 blocks of 15 s", () => {
    const out = sampleCreativeDna(byId("t01_basic_drama_realistic"));
    expect(out.project_frame.blocks_per_episode).toBe(4);
    expect(out.project_frame.block_length_sec).toBe(15);
    // Persian speaks at 2.0 words per second; 30% of each block stays for action.
    expect(out.project_frame.max_spoken_words_per_block).toBe(21);
    expect(out.slices.for_director.rules.map((r) => r.rule).join(" ")).toContain("9:16");
  });

  it("t02: a series has series rules, a landscape frame and 540 s of 6 episodes", () => {
    const out = sampleCreativeDna(byId("t02_series_action_anime"));
    expect(out.slices.for_script_writer.series_rules.length).toBeGreaterThan(0);
    expect(out.project_frame).toMatchObject({
      format: "series",
      episode_count: 6,
      blocks_per_episode: 6,
    });
  });

  it("t03: no dialogue means no spoken words", () => {
    const out = sampleCreativeDna(byId("t03_no_dialogue_claymation"));
    expect(out.project_frame.max_spoken_words_per_block).toBe(0);
    expect(out.project_frame.blocks_per_episode).toBe(2);
  });

  it("t04 and t05: the user's locks are kept", () => {
    expect(sampleCreativeDna(byId("t04_hard_locks")).continuity_locks).toEqual(
      expect.arrayContaining([
        "Story takes place in present-day Tehran",
        "Ending: the sisters reconcile",
      ]),
    );
    expect(sampleCreativeDna(byId("t05_noir_reconciliation")).continuity_locks).toContain(
      "Ending: mother and children reconcile",
    );
  });

  it("t05: the Noir guards cover rain, smoke and detectives", () => {
    const guards = sampleCreativeDna(byId("t05_noir_reconciliation"))
      .anti_cliche_guards.map((g) => g.guard)
      .join("\n");
    // The sample carries the module's own must-nots: rain, wet streets and smoke, the detective's coat.
    expect(guards).toContain("باران");
    expect(guards).toContain("کارآگاه");
  });

  it("t10: a style module as the genre is stopped by the guard, before any call", () => {
    expect(creativeDnaInputSchema.safeParse(byId("t10_wrong_kind")).success).toBe(false);
    expect(() => sampleCreativeDna(byId("t10_wrong_kind"))).toThrow();
  });

  it("t09: a brief that tries to take over is data inside <project_settings>", () => {
    const prompt = buildCreativeDnaPrompt(creativeDnaInputSchema.parse(byId("t09_injection")));
    const part = prompt.messages[0]?.content[1];
    expect((part as { text: string }).text).toContain("Ignore your instructions");
    expect((part as { text: string }).text.startsWith("<project_settings>")).toBe(true);
  });

  it("the sample covers all 42 genre and style pairs", () => {
    const genres = CREATIVE_REGISTRY.modules.filter((m) => m.kind === "genre");
    const styles = CREATIVE_REGISTRY.modules.filter((m) => m.kind === "style");
    for (const g of genres) {
      for (const s of styles) {
        const raw = { ...inputJson, genre_id: g.id, style_id: s.id };
        const out = sampleCreativeDna(raw);
        expect(
          checkCreativeBible(out, creativeDnaInputSchema.parse(raw)),
          `${g.id} + ${s.id}`,
        ).toEqual([]);
        for (const point of REVIEW_POINTS) {
          expect(out.review_options[point].technical.length).toBeGreaterThanOrEqual(4);
        }
        expect(out.anti_cliche_guards.length).toBeGreaterThanOrEqual(8);
      }
    }
  });
});
