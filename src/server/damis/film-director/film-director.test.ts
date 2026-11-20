/** DEPRECATED: tests of the provisional film-director Mode-B dami (deleted with its wiring). */
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { partText } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { countBreakpoints, outputFormatFor } from "../framework/request";
import { runDami } from "../framework/runner";
import { sampleFilmDirector } from "../sample/film-director";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { filmDirector } from "./dami";
import rawInput from "./fixtures/input.json";
import { buildFilmDirectorPrompt } from "./prompt";
import { FILM_DIRECTOR_SYSTEM } from "../director-style/prompt-text";
import { filmDirectorInputSchema, shotPlanSchema, type ShotPlan } from "./schema";
import { directorStyleCard } from "../director-style/styles";
import { checkShotPlan } from "./validate";

const inputJson = rawInput as unknown as z.input<typeof filmDirectorInputSchema>;
const input = filmDirectorInputSchema.parse(inputJson);
const plan = (): ShotPlan => structuredClone(shotPlanSchema.parse(sampleFilmDirector(inputJson)));

describe("film-director prompt", () => {
  it("sends the master prompt, the card, the project and the MODE B instruction", () => {
    const prompt = buildFilmDirectorPrompt(input);
    expect(partText(prompt.system[0])).toBe(FILM_DIRECTOR_SYSTEM);
    const [card, project] = prompt.messages[0]?.content ?? [];
    expect(partText(card)).toContain("<director_style_card>");
    expect(partText(card)).toContain(directorStyleCard("nolan"));
    const text = partText(project);
    for (const t of ["<creative_bible>", "<asset_registry>", "<script>", "<block_mode>"]) {
      expect(text).toContain(t);
    }
    expect(text).toContain("Work in MODE B");
    expect(text).toContain("Do NOT do steps 3, 6, 8 or 9");
    expect(text).toContain(input.script);
    expect(countBreakpoints(prompt)).toBe(3);
  });

  it("the shot plan schema is a valid structured-output schema with every top-level key required", () => {
    const sent = outputFormatFor(shotPlanSchema).schema as { required?: string[] };
    expect([...(sent.required ?? [])].sort()).toEqual(
      [
        "dami",
        "dami_version",
        "status",
        "directors_notes",
        "changes",
        "scene_geography",
        "beats",
        "shots",
        "warnings",
      ].sort(),
    );
  });
});

describe("film-director sample and checks", () => {
  it("the sample plan parses and passes the checks", () => {
    const out = plan();
    expect(out.shots.length).toBeGreaterThan(4);
    expect(out.scene_geography.map((g) => g.scene_id)).toEqual(["sc_1", "sc_2"]);
    for (const shot of out.shots) {
      expect(shot.duration_s).toBeGreaterThanOrEqual(3);
      expect(shot.duration_s).toBeLessThanOrEqual(6);
    }
    expect(checkShotPlan(out, input)).toEqual([]);
  });

  it("catches invented dialogue", () => {
    const out = plan();
    const shot = out.shots.find((s) => s.dialogue.length > 0);
    if (!shot?.dialogue[0]) throw new Error("fixture has dialogue");
    shot.dialogue[0].line = "I never said this.";
    expect(checkShotPlan(out, input).join("\n")).toContain('"I never said this." is not a line');
  });

  it("catches ids that are not in the asset registry, in fields and as @tokens", () => {
    const out = plan();
    const shot = out.shots[0];
    if (!shot?.staging[0]) throw new Error("fixture has staging");
    shot.staging[0].character_id = "char_9";
    shot.action = "@prop_7 falls off the table.";
    const errors = checkShotPlan(out, input).join("\n");
    expect(errors).toContain('"char_9" is not an id of the asset registry');
    expect(errors).toContain("@prop_7 is not an id of the asset registry");
    // provisional ids are allowed, as for the v1.4 Director
    shot.staging[0].character_id = "new_char_1";
    shot.action = "";
    expect(checkShotPlan(out, input)).toEqual([]);
  });

  it("catches shot ids out of sequence and durations outside (0, 30]", () => {
    const out = plan();
    const [first, second] = out.shots;
    if (!first || !second) throw new Error("fixture has shots");
    second.shot_id = "s3";
    first.duration_s = 0;
    second.duration_s = 31;
    const errors = checkShotPlan(out, input).join("\n");
    expect(errors).toContain('shot_id "s3" must be "s2"');
    expect(errors).toContain("s1: duration_s 0");
    expect(errors).toContain("s3: duration_s 31");
  });

  it("catches shots out of script order and uncovered script", () => {
    const out = plan();
    const swapped = structuredClone(out);
    const [a, b] = [swapped.shots[0], swapped.shots[3]];
    if (!a || !b) throw new Error("fixture has shots");
    [a.script_quote, b.script_quote] = [b.script_quote, a.script_quote];
    expect(checkShotPlan(swapped, input).join("\n")).toMatch(/not covered|not in the script/);

    const dropped = structuredClone(out);
    dropped.shots = dropped.shots
      .filter((_, i) => i !== 0)
      .map((s, i) => ({ ...s, shot_id: `s${i + 1}` }));
    expect(checkShotPlan(dropped, input).join("\n")).toContain("not covered by any shot");
  });

  it("catches a must-survive beat no shot plays and an unknown scene", () => {
    const out = plan();
    out.beats.push({ beat_id: "b99", scene_id: "sc_1", summary: "lost", must_survive: true });
    const shot = out.shots[0];
    if (!shot) throw new Error("fixture has shots");
    shot.scene_id = "sc_9";
    const errors = checkShotPlan(out, input).join("\n");
    expect(errors).toContain("beat b99 must survive");
    expect(errors).toContain('s1: scene_id "sc_9" has no scene_geography');
  });

  it("a blocked plan needs a reason and skips the checks", () => {
    const blocked = { ...plan(), status: "blocked", shots: [], warnings: [] };
    expect(shotPlanSchema.safeParse(blocked).success).toBe(false);
    const withReason = shotPlanSchema.parse({
      ...blocked,
      warnings: [{ type: "input_integrity", ref: "script", message: "empty script" }],
    });
    expect(checkShotPlan(withReason, input)).toEqual([]);
  });
});

describe("film-director damis", () => {
  it("film-director runs on Opus, streams, and returns the checked plan", async () => {
    const out = plan();
    const client = new FakeClaudeClient([jsonResponse(out)]);
    const result = await runDami(filmDirector, inputJson, {}, testDeps(client).deps);
    expect(result.output).toEqual(out);
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.opus);
    expect(client.methods[0]).toBe("stream");
  });
});
