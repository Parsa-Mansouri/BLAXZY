import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { partText } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { countBreakpoints, outputFormatFor } from "../framework/request";
import { runDami } from "../framework/runner";
import {
  sampleDirectorV2,
  sampleDirectorV2Plan,
  sampleDirectorV2Repair,
  sampleDirectorV2Shots,
} from "../sample/director-v2";
import { directorStyleCard } from "../director-style/styles";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { applyDirectorV2Repairs, assembleDirectorV2 } from "./assemble";
import { directorV2, directorV2Plan, directorV2Repair, directorV2Shots } from "./dami";
import rawInput from "./fixtures/input.json";
import { buildDirectorV2Prompt, DIRECTOR_STYLE_CARD_INSTRUCTION } from "./prompt";
import { DIRECTOR_V2_SYSTEM } from "./prompt-text";
import {
  costumeDescriptorFor,
  directorV2InputSchema,
  directorV2OutputSchema,
  directorV2PlanInputSchema,
  directorV2PlanOutputSchema,
  directorV2RepairInputSchema,
  directorV2RepairOutputSchema,
  directorV2ShotsInputSchema,
  directorV2ShotsOutputSchema,
  sceneRangeIds,
  type DirectorV2Output,
  type DirectorV2RepairInput,
  type DirectorV2ShotsInput,
} from "./schema";
import {
  checkDialogueMatchesScript,
  checkDirectorV2,
  checkDirectorV2Plan,
  checkDirectorV2Repair,
  checkDirectorV2Shots,
} from "./validate";

const lf = (text: string) => text.replace(/\r\n/g, "\n");
const fullJson = rawInput as unknown as z.input<typeof directorV2InputSchema>;
const input = directorV2InputSchema.parse(fullJson);
const planInput = directorV2PlanInputSchema.parse({ ...fullJson, mode: "plan" });
const full = (): DirectorV2Output =>
  structuredClone(directorV2OutputSchema.parse(sampleDirectorV2(fullJson)));
const plan = () => directorV2PlanOutputSchema.parse(sampleDirectorV2Plan(planInput));

function shotsInput(range: string): DirectorV2ShotsInput {
  return directorV2ShotsInputSchema.parse({
    ...fullJson,
    mode: "write_shots",
    plan: plan(),
    scene_range: range,
  });
}
function repairInput(need: "add" | "remove"): DirectorV2RepairInput {
  const out = full();
  const scene = out.shots.filter((s) => s.scene_id === "sc_1");
  return directorV2RepairInputSchema.parse({
    ...fullJson,
    mode: "repair",
    plan: plan(),
    current_shots: { shots: scene, staging_states: out.staging_states },
    repair_requests: [
      {
        scene_id: "sc_1",
        problem: "no_fit",
        sum_min_s: 10,
        sum_max_s: 13,
        need,
        target_options_s: [15],
        note: "",
      },
    ],
  });
}

describe("director-v2 source", () => {
  it("the system prompt is the owner's file from <role> to the end, verbatim", () => {
    const source = lf(readFileSync(join(__dirname, "source", "dami_director.system.md"), "utf8"));
    expect(DIRECTOR_V2_SYSTEM).toBe(source.slice(source.indexOf("<role>")).trimEnd());
    const head = source.slice(0, source.indexOf("<role>")).trim().split("\n");
    expect(head.every((l) => l.startsWith("#"))).toBe(true);
    expect(head[1]).toContain("v2.0");
    expect(DIRECTOR_V2_SYSTEM.endsWith("</code_side_validator>")).toBe(true);
  });

  it("each mode's output schema is a valid structured-output schema with the owner's top-level keys", () => {
    const keys = (schema: z.ZodType) =>
      [...((outputFormatFor(schema).schema as { required?: string[] }).required ?? [])].sort();
    expect(keys(directorV2OutputSchema)).toEqual(
      [
        "dami",
        "dami_version",
        "mode",
        "creative_bible_ref",
        "status",
        "project",
        "dramatic_analysis",
        "directors_notes",
        "continuity_bible",
        "scene_plan",
        "staging_states",
        "shots",
        "totals",
        "warnings",
      ].sort(),
    );
    expect(keys(directorV2RepairOutputSchema)).toEqual(
      ["dami", "dami_version", "mode", "status", "repairs", "warnings"].sort(),
    );
    expect(() => outputFormatFor(directorV2PlanOutputSchema)).not.toThrow();
    expect(() => outputFormatFor(directorV2ShotsOutputSchema)).not.toThrow();
  });
});

describe("director-v2 prompt", () => {
  it("sends the owner's prompt, then the style card and the precedence rule, then the project", () => {
    const prompt = buildDirectorV2Prompt(input);
    expect(partText(prompt.system[0])).toBe(DIRECTOR_V2_SYSTEM);
    const [card, project, perCall] = prompt.messages[0]?.content ?? [];
    expect(partText(card)).toContain(
      `<director_style_card>\n${directorStyleCard("nolan")}\n</director_style_card>`,
    );
    expect(partText(card)).toContain(DIRECTOR_STYLE_CARD_INSTRUCTION);
    expect(DIRECTOR_STYLE_CARD_INSTRUCTION).toContain("the bible wins");
    expect(DIRECTOR_STYLE_CARD_INSTRUCTION).toContain("name never travels");
    for (const t of [
      "<platform_config>",
      "<delivery_mode>",
      "<creative_bible>",
      "<asset_registry>",
      "<script>",
    ]) {
      expect(partText(project)).toContain(t);
    }
    expect(partText(perCall)).toContain("<mode>\nfull\n</mode>");
    expect(countBreakpoints(prompt)).toBe(3);
  });

  it("write_shots caches the plan (4 breakpoints) and states the scene-scoped ids", () => {
    const prompt = buildDirectorV2Prompt(shotsInput("sc_2"));
    expect(countBreakpoints(prompt)).toBe(4);
    const last = partText(prompt.messages[0]?.content[3]);
    expect(last).toContain("<scene_range>\nsc_2\n</scene_range>");
    expect(last).toContain("sh_<scene number>_<two-digit index>");
  });

  it("parses scene ranges against the plan's scenes", () => {
    const ids = ["sc_1", "sc_2", "sc_3"];
    expect(sceneRangeIds("sc_1-sc_2", ids)).toEqual(["sc_1", "sc_2"]);
    expect(sceneRangeIds("sc_3", ids)).toEqual(["sc_3"]);
    expect(sceneRangeIds("sc_3-sc_1", ids)).toBeNull();
    expect(sceneRangeIds("sc_4", ids)).toBeNull();
  });
});

describe("director-v2 samples pass their own checks", () => {
  it("full", () => {
    const out = full();
    expect(out.shots.length).toBeGreaterThan(4);
    expect(checkDirectorV2(out, input)).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/nolan/i);
  });
  it("plan", () => {
    expect(checkDirectorV2Plan(plan(), planInput)).toEqual([]);
  });
  it("write_shots, and the batches assemble into a valid full output", () => {
    const a = shotsInput("sc_1");
    const b = shotsInput("sc_2");
    const outA = directorV2ShotsOutputSchema.parse(sampleDirectorV2Shots(a));
    const outB = directorV2ShotsOutputSchema.parse(sampleDirectorV2Shots(b));
    expect(checkDirectorV2Shots(outA, a)).toEqual([]);
    expect(checkDirectorV2Shots(outB, b)).toEqual([]);
    const assembled = assembleDirectorV2(plan(), [outB, outA], 60);
    expect(assembled.shots.map((s) => s.order)).toEqual(assembled.shots.map((_, i) => i + 1));
    expect(assembled.shots[0]?.scene_id).toBe("sc_1");
    expect(
      checkDirectorV2(directorV2OutputSchema.parse({ ...assembled, mode: "full" }), input),
    ).toEqual([]);
    expect(() => assembleDirectorV2(plan(), [outA], 60)).toThrow(/sc_2/);
  });
  it("repair (add and remove), and applying it keeps the output valid", () => {
    for (const need of ["add", "remove"] as const) {
      const r = repairInput(need);
      const out = directorV2RepairOutputSchema.parse(sampleDirectorV2Repair(r));
      expect(checkDirectorV2Repair(out, r)).toEqual([]);
      const applied = applyDirectorV2Repairs(full(), out, 60);
      expect(checkDirectorV2(applied, input)).toEqual([]);
    }
  });
});

describe("director-v2 checks catch the owner's failure cases", () => {
  it("staging chain, unknown staging id and missing staging entry", () => {
    const out = full();
    const [a, b] = out.shots;
    if (!a || !b) throw new Error("shots");
    b.staging_start_id = "st_missing";
    a.assets.characters.push("char_2");
    a.staging_end_id = out.staging_states[0]?.staging_id ?? "";
    const errors = checkDirectorV2(out, input).join("\n");
    expect(errors).toContain('staging id "st_missing" is not in staging_states');
    expect(errors).toContain("must equal the shot before's staging_end_id");
  });

  it("duration order, spoken time, 70% rule, spoken_words count and block_15 max", () => {
    const out = full();
    const talk = out.shots.find((s) => s.dialogue.length > 0);
    const quiet = out.shots.find((s) => s.dialogue.length === 0);
    if (!talk || !quiet) throw new Error("shots");
    talk.duration = { min_s: 1, ideal_s: 1, max_s: 16 };
    talk.spoken_words += 1;
    quiet.duration = { min_s: 5, ideal_s: 4, max_s: 6 };
    const errors = checkDirectorV2(out, input).join("\n");
    expect(errors).toContain("shorter than the spoken time");
    expect(errors).toContain("exceed 70% of ideal_s");
    expect(errors).toContain("spoken_words is");
    expect(errors).toContain("over 15 s for block_15");
    expect(errors).toContain("1 ≤ min_s ≤ ideal_s ≤ max_s");
  });

  it("scene flexibility", () => {
    const out = full();
    for (const s of out.shots.filter((x) => x.scene_id === "sc_2")) {
      s.duration = {
        min_s: s.duration.ideal_s,
        ideal_s: s.duration.ideal_s,
        max_s: s.duration.ideal_s,
      };
    }
    expect(checkDirectorV2(out, input).join("\n")).toContain("sc_2: the shots' flexibility");
  });

  it("shot mode: short shots need rapid_cut and a trim anchor", () => {
    const shotMode = directorV2InputSchema.parse({ ...fullJson, delivery_mode: "shot" });
    const out = structuredClone(
      directorV2OutputSchema.parse(sampleDirectorV2({ ...fullJson, delivery_mode: "shot" })),
    );
    expect(checkDirectorV2(out, shotMode)).toEqual([]);
    const shot = out.shots.find((s) => s.dialogue.length === 0);
    if (!shot) throw new Error("shot");
    shot.duration = { min_s: 2, ideal_s: 2, max_s: 6 };
    shot.trim_anchor = null;
    expect(checkDirectorV2(out, shotMode).join("\n")).toContain(
      "needs rapid_cut true and a trim_anchor",
    );
  });

  it("continuous takes keep size, angle and move intent", () => {
    const out = full();
    const [a, b] = out.shots;
    if (!a || !b) throw new Error("shots");
    a.transition_after = "continuous";
    b.size = "extreme_close";
    expect(checkDirectorV2(out, input).join("\n")).toContain(
      "a continuous take keeps the same size",
    );
  });

  it("dialogue: reworded, dropped, speaker not in assets, on_screen for a heard-only speaker", () => {
    const out = full();
    const talk = out.shots.find((s) => s.dialogue.length > 0);
    const line = talk?.dialogue[0];
    if (!talk || !line) throw new Error("dialogue");
    line.line = `${line.line} Really.`;
    line.speaker_id = "char_9";
    const errors = checkDirectorV2(out, input).join("\n");
    expect(errors).toContain("exactly the script's spoken lines");
    expect(errors).toContain('speaker "char_9" is in neither');
    expect(errors).toContain('heard_as "on_screen" is only for a speaker in assets.characters');
    expect(
      checkDialogueMatchesScript(
        [{ shot_id: "s", dialogue: [{ ...line, line: "Not in it" }] }],
        "No cues here.",
        null,
      ),
    ).toEqual(['s: "Not in it" is not a line of the script at this point (in order)']);
  });

  it("asset ids, voice ids, outside references and look vocabulary", () => {
    const out = full();
    const shot = out.shots[0];
    if (!shot) throw new Error("shots");
    shot.assets.props.push("prop_9", "voice_1");
    shot.state_at_start = "Nora is still at the stove, as before.";
    shot.action = "Warm amber lighting glows; a 35mm lens.";
    const errors = checkDirectorV2(out, input).join("\n");
    expect(errors).toContain('asset_id "prop_9" is not in output_21');
    expect(errors).toContain('no "voice_" ids');
    expect(errors).toContain('state_at_start uses "still"');
    expect(errors).toContain('state_at_start uses "as before"');
    for (const word of ["amber", "lighting", "35mm", "lens"])
      expect(errors).toContain(`"${word}" is look vocabulary`);
  });

  it("runtime deviation needs a warning; totals must add up", () => {
    const out = full();
    out.warnings = out.warnings.filter((w) => w.type !== "runtime");
    out.totals.shot_count += 1;
    const errors = checkDirectorV2(out, input).join("\n");
    expect(errors).toContain("totals.shot_count must be");
    expect(errors).toContain('add a "runtime" warning');
  });

  it("scene ends: scene_change, and end only for the film's last shot", () => {
    const out = full();
    const lastOfScene1 = out.shots.filter((s) => s.scene_id === "sc_1").at(-1);
    if (!lastOfScene1) throw new Error("shots");
    lastOfScene1.transition_after = "cut";
    expect(checkDirectorV2(out, input).join("\n")).toContain(
      'needs transition_after "scene_change"',
    );
  });

  it("a rejected bible must block, and blocked needs a reason", () => {
    const rejected = directorV2InputSchema.parse({
      ...fullJson,
      creative_bible: { ...input.creative_bible, validation_status: "rejected" },
    });
    expect(checkDirectorV2(full(), rejected)).toEqual([
      'the Creative Bible is "rejected": answer with status "blocked" and the reason in warnings',
    ]);
    const blocked = directorV2OutputSchema.parse(sampleDirectorV2(rejected));
    expect(blocked.status).toBe("blocked");
    expect(checkDirectorV2(blocked, rejected)).toEqual([]);
    expect(directorV2OutputSchema.safeParse({ ...blocked, warnings: [] }).success).toBe(false);
  });

  it("write_shots: scenes outside the range, owner-style ids, re-sent plan states", () => {
    const i = shotsInput("sc_1");
    const out = structuredClone(directorV2ShotsOutputSchema.parse(sampleDirectorV2Shots(i)));
    const shot = out.shots[0];
    const state = i.plan.staging_states[0];
    if (!shot || !state) throw new Error("fixture");
    shot.shot_id = "sh_0001";
    out.staging_states.push(state);
    const errors = checkDirectorV2Shots(out, i).join("\n");
    expect(errors).toContain("scene-scoped");
    expect(errors).toContain("is the plan's; return only the states this batch adds");
    const other = shotsInput("sc_2");
    expect(checkDirectorV2Shots(out, other).join("\n")).toContain(
      'scene_id "sc_1" is not one of sc_2',
    );
  });

  it("repair: other scenes, changed dialogue, a request left unanswered", () => {
    const r = repairInput("add");
    const out = structuredClone(directorV2RepairOutputSchema.parse(sampleDirectorV2Repair(r)));
    const repair = out.repairs[0];
    const line = repair?.shots.find((s) => s.dialogue.length > 0)?.dialogue[0];
    if (!repair || !line) throw new Error("repair");
    line.line = "A new line.";
    out.repairs.push({ ...repair, scene_id: "sc_2" });
    const errors = checkDirectorV2Repair(out, r).join("\n");
    expect(errors).toContain("sc_2 was not requested");
    expect(errors).toContain("must keep its dialogue exactly");
    const empty = { ...out, repairs: [] };
    expect(checkDirectorV2Repair(empty, r).join("\n")).toContain('add a "repair_failed" warning');
    const failed = {
      ...empty,
      warnings: [{ type: "repair_failed" as const, ref: "sc_1", message: "No honest fit." }],
    };
    expect(checkDirectorV2Repair(failed, r)).toEqual([]);
  });

  it("costume versions: the version in force by shot or (from a plan) by scene", () => {
    const out = full();
    const bible = structuredClone(out.continuity_bible);
    const nora = bible.characters[0];
    const firstOfScene2 = out.shots.find((s) => s.scene_id === "sc_2");
    if (!nora || !firstOfScene2) throw new Error("fixture");
    nora.costume_versions = [{ from_shot: "sc_2", descriptor: "in a coat" }];
    expect(costumeDescriptorFor(bible, nora.asset_id, out.shots[0]?.shot_id ?? "", out.shots)).toBe(
      nora.descriptor,
    );
    expect(costumeDescriptorFor(bible, nora.asset_id, firstOfScene2.shot_id, out.shots)).toBe(
      "in a coat",
    );
  });
});

describe("director-v2 damis", () => {
  it("run on Opus at medium effort and stream", async () => {
    const fc = new FakeClaudeClient([jsonResponse(sampleDirectorV2(fullJson))]);
    await runDami(directorV2, fullJson, {}, testDeps(fc).deps);
    const pc = new FakeClaudeClient([jsonResponse(sampleDirectorV2Plan(planInput))]);
    await runDami(directorV2Plan, planInput, {}, testDeps(pc).deps);
    for (const client of [fc, pc]) {
      expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.opus);
      expect(client.requests[0]?.output_config?.effort).toBe("medium");
      expect(client.methods[0]).toBe("stream");
    }
    const s = shotsInput("sc_1");
    const client = new FakeClaudeClient([jsonResponse(sampleDirectorV2Shots(s))]);
    expect((await runDami(directorV2Shots, s, {}, testDeps(client).deps)).output.mode).toBe(
      "write_shots",
    );
    const r = repairInput("add");
    const rc = new FakeClaudeClient([jsonResponse(sampleDirectorV2Repair(r))]);
    expect((await runDami(directorV2Repair, r, {}, testDeps(rc).deps)).output.repairs).toHaveLength(
      1,
    );
  });
});
