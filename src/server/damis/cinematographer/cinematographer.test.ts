import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { partText } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { outputFormatFor } from "../framework/request";
import { runDami } from "../framework/runner";
import { sampleFilmDirector } from "../sample/film-director";
import { sampleCinematographer } from "../sample/cinematographer";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import filmDirectorInput from "../film-director/fixtures/input.json";
import { shotPlanSchema } from "../film-director/schema";
import { cinematographer } from "./dami";
import lookInputJson from "./fixtures/look-input.json";
import { CINEMATOGRAPHER_IDS, CINEMATOGRAPHERS, cinematographerCard, isCardMode } from "./library";
import { buildCinematographerPrompt } from "./prompt";
import {
  cinematographerInputSchema,
  cinematographerOutputSchema,
  lookInputSchema,
  sceneInputSchema,
  sceneShotsFor,
  type CinematographerOutput,
  type SceneInput,
} from "./schema";
import { checkCinematographer } from "./validate";

const lf = (text: string) => text.replace(/\r\n/g, "\n");
const lookInput = lookInputSchema.parse(lookInputJson);
const shotPlan = shotPlanSchema.parse(sampleFilmDirector(filmDirectorInput));

function lookAnswer(): CinematographerOutput {
  return cinematographerOutputSchema.parse(sampleCinematographer(lookInput));
}

function sceneInput(): SceneInput {
  const look = lookAnswer().look;
  if (!look) throw new Error("sample look");
  return sceneInputSchema.parse({
    mode: "scene",
    cinematographer_id: "deakins",
    look,
    scene: { scene_id: "sc_1", location_label: "kitchen", time_of_day: "evening" },
    shots: sceneShotsFor(shotPlan, "sc_1"),
  });
}

describe("cinematographer cards", () => {
  it("every card is the owner's source file, verbatim", () => {
    expect(CINEMATOGRAPHERS.map((c) => c.id)).toEqual([...CINEMATOGRAPHER_IDS]);
    for (const card of CINEMATOGRAPHERS) {
      const source = lf(readFileSync(join(__dirname, "source", card.sourceFile), "utf8"));
      expect(card.system).toBe(source.trimEnd());
      expect(card.sourceFile).toContain(`_v${card.version}.md`);
    }
  });

  it("each card's modes are exactly the modes of its '### Modes' section", () => {
    for (const card of CINEMATOGRAPHERS) {
      const start = card.system.indexOf("### Modes");
      expect(start).toBeGreaterThan(0);
      const end = card.system.indexOf("\n## ", start);
      const section = card.system.slice(start, end);
      const letters = [...new Set([...section.matchAll(/Mode ([A-D])\b/g)].map((m) => m[1]))];
      expect(letters.sort()).toEqual(card.modes.map((m) => m.id));
      for (const mode of card.modes) {
        expect(section.toLowerCase()).toContain(mode.name.toLowerCase());
      }
      expect(isCardMode(card.id, card.defaultModeId)).toBe(true);
    }
  });
});

describe("cinematographer prompt", () => {
  it("sends the chosen card as the system prompt and frames the job as a film DP", () => {
    const prompt = buildCinematographerPrompt(lookInput);
    expect(partText(prompt.system[0])).toBe(cinematographerCard("deakins").system);
    const text = partText(prompt.messages[0]?.content[0]);
    expect(text).toContain("director of photography of a whole film");
    expect(text).toContain("Rule 3 does not apply");
    expect(text).toContain("<scenes>");
    expect(text).toContain('Mode "look"');

    const scene = buildCinematographerPrompt(sceneInput());
    const [stable, perScene] = scene.messages[0]?.content ?? [];
    expect(stable?.cache).toBe(true);
    expect(partText(stable)).toContain("<look>");
    expect(partText(perScene)).toContain("<shots>");
    expect(partText(perScene)).toContain('Mode "scene"');
  });

  it("the output wrapper is a valid structured-output schema", () => {
    expect(() => outputFormatFor(cinematographerOutputSchema)).not.toThrow();
    expect(cinematographerInputSchema.safeParse({ ...lookInput, mode: "other" }).success).toBe(
      false,
    );
  });
});

describe("cinematographer checks", () => {
  it("the sample look and scene answers pass", () => {
    expect(checkCinematographer(lookAnswer(), lookInput)).toEqual([]);
    const input = sceneInput();
    const answer = cinematographerOutputSchema.parse(sampleCinematographer(input));
    expect(answer.scene?.shots.map((s) => s.shot_id)).toEqual(input.shots.map((s) => s.shot_id));
    expect(checkCinematographer(answer, input)).toEqual([]);
  });

  it("catches a mode the card does not have, and a scene answered twice or not at all", () => {
    const answer = lookAnswer();
    if (!answer.look) throw new Error("look");
    const [first] = answer.look.scene_modes;
    if (!first) throw new Error("modes");
    first.mode_id = "D";
    answer.look.scene_modes = [first, { ...first, mode_id: "A" }];
    const errors = checkCinematographer(answer, lookInput).join("\n");
    expect(errors).toContain('mode_id "D" is not a mode of the deakins card');
    expect(errors).toContain('scene "sc_1" needs exactly one mode (has 2)');
    expect(errors).toContain('scene "sc_2" needs exactly one mode (has 0)');
  });

  it("catches missing and unknown shot answers and a wrong scene id", () => {
    const input = sceneInput();
    const answer = cinematographerOutputSchema.parse(sampleCinematographer(input));
    if (!answer.scene) throw new Error("scene");
    const [first, ...rest] = answer.scene.shots;
    if (!first) throw new Error("shots");
    answer.scene.shots = [...rest, { ...first, shot_id: "s99" }];
    answer.scene.scene_id = "sc_2";
    const errors = checkCinematographer(answer, input).join("\n");
    expect(errors).toContain(`shot "${first.shot_id}" must be answered exactly once`);
    expect(errors).toContain('"s99" is not one of the input shots');
    expect(errors).toContain('scene.scene_id must be "sc_1"');
  });

  it("catches an answer in the wrong mode", () => {
    const answer = lookAnswer();
    expect(checkCinematographer(answer, sceneInput())).toEqual(['mode must be "scene"']);
    expect(checkCinematographer({ ...answer, look: null }, lookInput)[0]).toContain("needs `look`");
  });
});

describe("cinematographer dami", () => {
  it("runs on Sonnet at low effort and finalizes to the mode's half", async () => {
    const client = new FakeClaudeClient([jsonResponse(lookAnswer())]);
    const result = await runDami(cinematographer, lookInput, {}, testDeps(client).deps);
    expect(result.output.mode).toBe("look");
    if (result.output.mode !== "look") throw new Error("look");
    expect(result.output.look.scene_modes).toHaveLength(2);
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.sonnet);
    expect(client.requests[0]?.output_config?.effort).toBe("low");
  });
});
