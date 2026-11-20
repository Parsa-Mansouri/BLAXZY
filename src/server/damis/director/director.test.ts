import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { CLAUDE_MODELS } from "../framework/models";
import { countBreakpoints, outputFormatFor } from "../framework/request";
import { runDami } from "../framework/runner";
import { sampleDirector } from "../sample/director";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { director, directorPlan } from "./dami";
import rawInput from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { buildDirectorPrompt, directorBible, SHOT_PLAN_INSTRUCTION } from "./prompt";
import { DIRECTOR_SYSTEM } from "./prompt-text";
import {
  blockedSkeletonSchema,
  directorInputSchema,
  directorOutputSchema,
  directorPlanInputSchema,
  directorPlanOutputSchema,
  blockSchema,
  isBlocked,
  parseBlockRange,
  storedBlockSchema,
  storedContinuityBibleSchema,
  storedDirectorPlanOutputSchema,
  type DirectorOutput,
  type DirectorPlanOutput,
} from "./schema";
import { checkDirector, checkDirectorPlan } from "./validate";

const SOURCE = join(__dirname, "source");
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const inputJson = rawInput as unknown as z.input<typeof directorInputSchema>;
const input = directorInputSchema.parse(inputJson);
const output = directorOutputSchema.parse(outputJson);

describe("director source", () => {
  const sourceMd = lf(readFileSync(join(SOURCE, "dami_director.system.md"), "utf8"));

  it("the system prompt is the owner's file from <role> to the end", () => {
    expect(DIRECTOR_SYSTEM).toBe(sourceMd.slice(sourceMd.indexOf("<role>")).trimEnd());
    const header = sourceMd.slice(0, sourceMd.indexOf("<role>")).trim().split("\n");
    expect(header.every((l) => l.startsWith("#"))).toBe(true);
    expect(header[0]).toContain("DIRECTOR");
    expect(DIRECTOR_SYSTEM).not.toContain("# DAMI");
    expect(DIRECTOR_SYSTEM.startsWith("<role>")).toBe(true);
    expect(DIRECTOR_SYSTEM.endsWith("</code_side_validator>")).toBe(true);
  });

  it("the output schemas carry every key of the owner's output_format", () => {
    const requiredOf = (schema: unknown, key: string): string[] => {
      let found: string[] | null = null;
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (typeof node !== "object" || node === null) return;
        const obj = node as { properties?: Record<string, unknown>; required?: string[] };
        if (obj.properties && key in obj.properties && !found) found = obj.required ?? [];
        Object.values(obj).forEach(walk);
      };
      walk(schema);
      return found ?? [];
    };
    const sent = outputFormatFor(directorOutputSchema).schema as { required?: string[] };
    expect([...(sent.required ?? [])].sort()).toEqual(
      [
        "dami",
        "dami_version",
        "creative_bible_ref",
        "status",
        "project",
        "dramatic_analysis",
        "directors_notes",
        "continuity_bible",
        "blocks",
        "totals",
        "warnings",
      ].sort(),
    );
    const blockKeys = requiredOf(sent, "prompt_text");
    for (const key of ["shots", "prompt_text", "word_count", "start_staging", "end_staging"]) {
      expect(blockKeys).toContain(key);
    }
    const planKeys = requiredOf(outputFormatFor(directorPlanOutputSchema).schema, "end_staging");
    expect(planKeys).toContain("end_staging");
    for (const key of ["shots", "prompt_text", "word_count"]) expect(planKeys).not.toContain(key);
  });

  it("the structured-output schemas are closed: no free-form objects", () => {
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== "object" || node === null) return;
      const obj = node as Record<string, unknown>;
      if (obj.type === "object") expect(obj.additionalProperties).toBe(false);
      Object.values(obj).forEach(walk);
    };
    walk(outputFormatFor(directorOutputSchema).schema);
    walk(outputFormatFor(directorPlanOutputSchema).schema);
  });
});

describe("director schema", () => {
  it("parses the fixtures and defaults the platform numbers", () => {
    expect(input.platform_config.block_length_options_sec).toEqual([15, 30]);
    expect(input.platform_config.max_events_per_block).toEqual({ "15": 2, "30": 4 });
    expect(output.blocks).toHaveLength(4);
    expect(output.continuity_bible).not.toHaveProperty("voices");
  });

  it("reads a block and a plan stored by Director v1.3 (voices, no heard_only or heard_as)", () => {
    const legacy = structuredClone(outputJson) as unknown as {
      continuity_bible: Record<string, unknown>;
      blocks: {
        assets: Record<string, unknown>;
        shots: { dialogue: Record<string, unknown>[] }[];
      }[];
    };
    legacy.continuity_bible.voices = [{ asset_id: "voice_1", character_id: "char_1", note: "" }];
    for (const b of legacy.blocks) {
      delete b.assets.heard_only;
      b.assets.voices = ["voice_1"];
      for (const s of b.shots) for (const d of s.dialogue) delete d.heard_as;
    }
    const first = legacy.blocks[0];
    expect(blockSchema.safeParse(first).success).toBe(false);
    const block = storedBlockSchema.parse(first);
    expect(block.assets.heard_only).toEqual([]);
    expect(block.assets).not.toHaveProperty("voices");
    expect(block.shots.flatMap((s) => s.dialogue).map((d) => d.heard_as)).toContain("on_screen");
    // A speaker not in the block's characters was heard, not seen.
    const offFrame = structuredClone(first);
    offFrame.assets.characters = [];
    const heard = storedBlockSchema.parse(offFrame).shots.flatMap((s) => s.dialogue);
    expect(heard.every((d) => d.heard_as === "off_screen")).toBe(true);
    const bible = storedContinuityBibleSchema.parse(legacy.continuity_bible);
    expect(bible).not.toHaveProperty("voices");
    const plan = storedDirectorPlanOutputSchema.parse(legacy);
    expect(plan.blocks.every((b) => b.assets.heard_only.length === 0)).toBe(true);
    // A stored v1.3 plan is accepted as write_blocks input.
    const write = directorInputSchema.safeParse({
      ...inputJson,
      mode: "write_blocks",
      plan: legacy,
      block_range: "1-2",
    });
    expect(write.success).toBe(true);
    // A current block passes through unchanged.
    expect(storedBlockSchema.parse(outputJson.blocks[0])).toEqual(output.blocks[0]);
  });

  it("write_blocks needs a plan and a block_range; plan mode has its own input", () => {
    expect(directorInputSchema.safeParse({ ...inputJson, mode: "write_blocks" }).success).toBe(
      false,
    );
    expect(directorInputSchema.safeParse({ ...inputJson, mode: "plan" }).success).toBe(false);
    expect(directorPlanInputSchema.safeParse({ ...inputJson, mode: "plan" }).success).toBe(true);
    expect(directorPlanInputSchema.safeParse(inputJson).success).toBe(false);
    const plan = sampleDirector({ ...inputJson, mode: "plan" });
    expect(
      directorInputSchema.safeParse({
        ...inputJson,
        mode: "write_blocks",
        plan,
        block_range: "1-2",
      }).success,
    ).toBe(true);
    expect(
      directorInputSchema.safeParse({ ...inputJson, mode: "write_blocks", plan, block_range: "x" })
        .success,
    ).toBe(false);
  });

  it("parseBlockRange", () => {
    expect(parseBlockRange("9-16")).toEqual({ from: 9, to: 16 });
    expect(parseBlockRange("3-3")).toEqual({ from: 3, to: 3 });
    expect(parseBlockRange("5-2")).toBeNull();
    expect(parseBlockRange("0-2")).toBeNull();
    expect(parseBlockRange("a")).toBeNull();
  });

  it("an answer needs blocks and shots unless it is blocked", () => {
    expect(directorOutputSchema.safeParse({ ...outputJson, blocks: [] }).success).toBe(false);
    const noShots = structuredClone(outputJson);
    noShots.blocks[0].shots = [];
    expect(directorOutputSchema.safeParse(noShots).success).toBe(false);
    const blocked = { ...outputJson, status: "blocked", blocks: [], warnings: [] };
    expect(directorOutputSchema.safeParse(blocked).success).toBe(false);
    expect(
      directorOutputSchema.safeParse({
        ...blocked,
        warnings: [{ type: "input_integrity", ref: "creative_bible", message: "rejected" }],
      }).success,
    ).toBe(true);
    expect(
      blockedSkeletonSchema.safeParse({
        dami: "director",
        status: "blocked",
        warnings: [{ type: "qc", ref: "", message: "no" }],
      }).success,
    ).toBe(true);
    expect(isBlocked({ status: "blocked" })).toBe(true);
  });

  it("a plan block has no shots, prompt_text or word_count", () => {
    const plan = sampleDirector({ ...inputJson, mode: "plan" }) as DirectorPlanOutput;
    expect(directorPlanOutputSchema.safeParse(plan).success).toBe(true);
    for (const block of plan.blocks) {
      expect(block).not.toHaveProperty("shots");
      expect(block).not.toHaveProperty("prompt_text");
      expect(block).not.toHaveProperty("word_count");
    }
  });
});

describe("director prompt", () => {
  it("caches the system prompt and the project data, and sends the mode last", () => {
    const prompt = buildDirectorPrompt(input);
    expect(prompt.system).toEqual([{ text: DIRECTOR_SYSTEM, cache: true }]);
    expect(countBreakpoints(prompt)).toBe(2);
    const [stable, perCall] = prompt.messages[0]?.content ?? [];
    const text = (part: unknown) => (part as { text: string }).text;
    expect(stable).toMatchObject({ cache: true });
    expect(perCall).not.toHaveProperty("cache");
    for (const tag of [
      "platform_config",
      "block_mode",
      "creative_bible",
      "asset_registry",
      "script",
    ]) {
      expect(text(stable)).toContain(`<${tag}>`);
    }
    expect(text(perCall)).toContain("<mode>\nfull\n</mode>");
    expect(text(stable)).not.toContain("<plan>");
  });

  it("write_blocks adds the plan (cached) and the range; at most 4 breakpoints", () => {
    const plan = sampleDirector({ ...inputJson, mode: "plan" });
    const wb = directorInputSchema.parse({
      ...inputJson,
      mode: "write_blocks",
      plan,
      block_range: "3-4",
    });
    const prompt = buildDirectorPrompt(wb);
    expect(countBreakpoints(prompt)).toBe(3);
    const parts = (prompt.messages[0]?.content ?? []).map((p) => (p as { text: string }).text);
    expect(parts[1]).toContain("<plan>");
    expect(parts[2]).toContain("<block_range>\n3-4\n</block_range>");
  });

  it("a craft batch adds the shot plan and visual layer to the per-call turn only", () => {
    const plan = sampleDirector({ ...inputJson, mode: "plan" });
    const shot = {
      shot_id: "s1",
      scene_id: "sc_1",
      size: "wide",
      camera: {
        position: "south",
        height: "eye level",
        angle: "low",
        movement: "push in",
        background: "wall",
      },
      staging: ["char_1: frame-left, midground"],
      props: [],
      action: "Nora waits.",
      dialogue: [],
      sound: "room tone",
      cut_reason: "on the look",
      start_state: "Nora by the door.",
      end_state: "Nora by the door.",
      windows: [{ from_s: 0, to_s: 5 }],
    };
    const wb = directorInputSchema.parse({
      ...inputJson,
      mode: "write_blocks",
      plan,
      block_range: "1-1",
      shot_plan: [{ block_id: 1, shots: [shot] }],
      visual_layer: { look: "Soft window light.", shots: [] },
    });
    const prompt = buildDirectorPrompt(wb);
    expect(prompt.system).toEqual([{ text: DIRECTOR_SYSTEM, cache: true }]);
    expect(countBreakpoints(prompt)).toBe(3);
    const parts = (prompt.messages[0]?.content ?? []).map((p) => (p as { text: string }).text);
    expect(parts[0]).not.toContain("<shot_plan>");
    expect(parts[2]).toContain("<shot_plan>");
    expect(parts[2]).toContain("<visual_layer>");
    expect(parts[2]).toContain(SHOT_PLAN_INSTRUCTION);
    // Only write_blocks takes a shot plan.
    expect(
      directorInputSchema.safeParse({
        ...inputJson,
        mode: "full",
        shot_plan: [{ block_id: 1, shots: [shot] }],
      }).success,
    ).toBe(false);
  });

  it("the creative bible block is the owner's list: no review options, but open questions and status", () => {
    const sent = directorBible(input.creative_bible);
    expect(Object.keys(sent).sort()).toEqual(
      [
        "selection",
        "project_frame",
        "contracts",
        "slices",
        "continuity_locks",
        "anti_cliche_guards",
        "qc_checklist",
        "open_questions",
        "validation_status",
      ].sort(),
    );
    expect(Object.keys(sent.slices).sort()).toEqual(["for_director", "for_text_blocks_video"]);
    expect(JSON.stringify(sent)).not.toContain("review_options");
    for (const q of sent.qc_checklist) expect(["text_block", "video", "all"]).toContain(q.stage);
  });
});

describe("director check() on the fixture and the sample", () => {
  it("the fixture answer passes", () => {
    expect(checkDirector(output, input)).toEqual([]);
  });

  it("the sample passes in full mode", () => {
    const sample = sampleDirector(inputJson) as DirectorOutput;
    expect(checkDirector(sample, input)).toEqual([]);
    expect(sample.blocks.map((b) => b.continuity.type)).toEqual([
      "first",
      "continuous",
      "new_scene",
      "continuous",
    ]);
    expect(sample.totals).toMatchObject({ block_count: 4, total_runtime_s: 60, deviation_pct: 0 });
  });

  it("the sample passes in plan mode, then write_blocks batches match a full run", () => {
    const planInput = directorPlanInputSchema.parse({ ...inputJson, mode: "plan" });
    const plan = sampleDirector(planInput) as DirectorPlanOutput;
    expect(checkDirectorPlan(plan, planInput)).toEqual([]);
    for (const range of ["1-2", "3-4", "2-3"]) {
      const wb = directorInputSchema.parse({
        ...inputJson,
        mode: "write_blocks",
        plan,
        block_range: range,
      });
      const written = sampleDirector(wb) as DirectorOutput;
      expect(checkDirector(written, wb), range).toEqual([]);
      const { from, to } = parseBlockRange(range) ?? { from: 0, to: 0 };
      expect(written.blocks.map((b) => b.block_id)).toEqual(
        Array.from({ length: to - from + 1 }, (_, i) => from + i),
      );
      expect(written.blocks).toEqual(output.blocks.slice(from - 1, to));
    }
  });

  it("the sample handles fixed_30, a script without headings, unknown speakers and scripts that run over", () => {
    const fixed30 = directorInputSchema.parse({ ...inputJson, block_mode: "fixed_30" });
    const long = sampleDirector(fixed30) as DirectorOutput;
    expect(checkDirector(long, fixed30)).toEqual([]);
    expect(long.blocks.every((b) => b.duration_s === 30 && b.shots.length === 5)).toBe(true);
    expect(long.totals).toMatchObject({ count_30: 2, total_runtime_s: 60 });

    // A target far from the blocks' runtime needs a runtime warning (and gets one).
    const target = structuredClone(inputJson.creative_bible);
    target.project_frame.episode_duration_sec = 120;
    const over = directorInputSchema.parse({ ...inputJson, creative_bible: target });
    const overOut = sampleDirector(over) as DirectorOutput;
    expect(overOut.warnings.map((w) => w.type)).toContain("runtime");
    expect(overOut.totals.deviation_pct).toBe(50);
    expect(checkDirector(overOut, over)).toEqual([]);
    const silenced = { ...overOut, warnings: [] };
    expect(checkDirector(silenced, over).join("\n")).toContain("deviation_pct");

    const plain = directorInputSchema.parse({
      ...inputJson,
      asset_registry: { characters: [], locations: [], props: [], scene_index: [] },
      script:
        "Rain taps the window of a small flat.\n\nOMAR\nI still miss the sea.\n\nOmar closes the curtain and sits down.",
    });
    const plainOut = sampleDirector(plain) as DirectorOutput;
    expect(checkDirector(plainOut, plain)).toEqual([]);
    expect(plainOut.warnings.map((w) => w.type)).toContain("missing_asset");
    expect(plainOut.continuity_bible.characters[0]?.asset_id).toBe("new_char_1");
    // "still" is in the spoken line: the dialogue is exempt from the forbidden-word check.
    expect(plainOut.blocks[0]?.prompt_text).toContain("I still miss the sea.");
  });

  it("a rejected Creative Bible answers blocked and the check accepts only that", () => {
    const rejected = directorInputSchema.parse({
      ...inputJson,
      creative_bible: { ...inputJson.creative_bible, validation_status: "rejected" },
    });
    const blocked = sampleDirector(rejected) as DirectorOutput;
    expect(blocked.status).toBe("blocked");
    expect(directorOutputSchema.safeParse(blocked).success).toBe(true);
    expect(checkDirector(blocked, rejected)).toEqual([]);
    expect(checkDirector(output, rejected).join("\n")).toContain("rejected");
    expect(checkDirector(blocked, input).join("\n")).toContain("blocked");
  });
});

describe("director run", () => {
  it("runs on Opus, streams, and takes the fixture answer", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(director, inputJson, {}, testDeps(client).deps);
    expect(result.output).toEqual(output);
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.opus);
    expect(client.methods[0]).toBe("stream");
    expect(director.version).toBe("1.2.0");
  });

  it("sends the failed checks back once, then accepts the corrected answer", async () => {
    const wrong = structuredClone(outputJson);
    wrong.blocks[1].prompt_text = wrong.blocks[1].prompt_text.replace("Staging:", "Placement:");
    const client = new FakeClaudeClient([jsonResponse(wrong), jsonResponse(outputJson)]);
    const result = await runDami(director, inputJson, {}, testDeps(client).deps);
    expect(client.requests).toHaveLength(2);
    expect(result.output.blocks[1]?.prompt_text).toContain("Staging:");
  });

  it("director-plan runs the plan pass; the director dami refuses mode plan", async () => {
    const planInput = { ...inputJson, mode: "plan" as const };
    const plan = sampleDirector(planInput);
    const client = new FakeClaudeClient([jsonResponse(plan)]);
    const result = await runDami(directorPlan, planInput, {}, testDeps(client).deps);
    expect(result.output.blocks).toHaveLength(4);
    await expect(
      runDami(director, planInput as never, {}, testDeps(new FakeClaudeClient([])).deps),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});
