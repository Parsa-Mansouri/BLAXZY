import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { directorV2OutputSchema } from "../director-v2/schema";
import { partText } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { countBreakpoints, outputFormatFor } from "../framework/request";
import { runDami } from "../framework/runner";
import { samplePrompter } from "../sample/prompter";
import { sampleCinematographerShots } from "../sample/cinematographer-v1";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { prompter } from "./dami";
import fixture from "./fixtures/input.json";
import { buildPrompterPrompt } from "./prompt";
import { PROMPTER_SYSTEM } from "./prompt-text";
import { sampleUnits } from "./sample-units";
import {
  prompterInputSchema,
  prompterOutputSchema,
  type PrompterInput,
  type PrompterOutput,
} from "./schema";
import { checkPrompter } from "./validate";

const rawInput = fixture as unknown as z.input<typeof prompterInputSchema>;
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const input = prompterInputSchema.parse(rawInput);
const answer = (i: PrompterInput = input): PrompterOutput =>
  structuredClone(prompterOutputSchema.parse(samplePrompter(i)));
const NAMES = ["Nolan", "Deakins", "Christopher", "Roger"];

function shotModeInput(): PrompterInput {
  return prompterInputSchema.parse({
    ...rawInput,
    units: sampleUnits(directorV2OutputSchema.parse(fixture.director), "shot", 4),
  });
}

describe("prompter source", () => {
  it("the system prompt is the owner's file from <role> through </code_side_validator>, verbatim", () => {
    const source = lf(readFileSync(join(__dirname, "source", "dami_prompter.system.md"), "utf8"));
    const end = source.indexOf("</code_side_validator>") + "</code_side_validator>".length;
    expect(PROMPTER_SYSTEM).toBe(source.slice(source.indexOf("<role>"), end));
    expect(PROMPTER_SYSTEM).not.toContain("<assembly_note>");
    expect(source.slice(end)).toContain("<assembly_note>");
    expect(source.split("\n")[1]).toContain("v1.0");
  });

  it("the output schema is a valid structured-output schema", () => {
    expect(() => outputFormatFor(prompterOutputSchema)).not.toThrow();
  });
});

describe("prompter prompt", () => {
  it("caches the project and the run, then sends the batch's shots and units", () => {
    const prompt = buildPrompterPrompt(input);
    expect(partText(prompt.system[0])).toBe(PROMPTER_SYSTEM);
    const [project, run, batch] = prompt.messages[0]?.content ?? [];
    expect(partText(project)).toContain("<platform_config>");
    expect(partText(project)).toContain('"prompt_words"');
    expect(partText(run)).toContain("<director>");
    expect(partText(run)).toContain("<cinematographer>");
    expect(partText(batch)).toContain("<units>");
    expect(countBreakpoints(prompt)).toBe(3);
    for (const name of NAMES) expect(JSON.stringify(prompt)).not.toContain(name);
  });
});

describe("prompter samples", () => {
  it("block units pass the checks and never name the director or DP", () => {
    const out = answer();
    expect(out.units.map((u) => u.status)).toEqual(input.units.map(() => "ok"));
    expect(checkPrompter(out, input)).toEqual([]);
    for (const u of out.units) for (const name of NAMES) expect(u.prompt_text).not.toContain(name);
  });

  it("shot units pass the checks", () => {
    const i = shotModeInput();
    const out = answer(i);
    expect(out.units.every((u) => u.prompt_text.includes("No cuts."))).toBe(true);
    expect(checkPrompter(out, i)).toEqual([]);
  });

  it("a unit whose shots are missing is skipped, and must be", () => {
    const i = prompterInputSchema.parse({
      ...rawInput,
      cinematographer: { ...input.cinematographer, shots: input.cinematographer.shots.slice(1) },
    });
    const out = answer(i);
    expect(out.units[0]?.status).toBe("skipped");
    expect(checkPrompter(out, i)).toEqual([]);
    const notSkipped = answer();
    expect(checkPrompter(notSkipped, i).join("\n")).toContain(
      'skip the unit with a "missing_shot_data" warning',
    );
  });
});

describe("prompter checks", () => {
  it("layout markers, windows and cut markers", () => {
    const out = answer();
    const unit = out.units[0];
    if (!unit) throw new Error("unit");
    unit.prompt_text = unit.prompt_text
      .replace("Staging:", "Blocking:")
      .replace(/\[0-(\d+)s\]/, "[0-99s]")
      .replace("Cut to Shot", "Then Shot");
    const errors = checkPrompter(out, input).join("\n");
    expect(errors).toContain('missing "Staging:"');
    expect(errors).toContain("the shot windows must be BREAKDOWN's");
    expect(errors).toContain('"Cut to Shot" must appear');
  });

  it("frozen texts, @ tokens, dialogue once, forbidden words, word range", () => {
    const out = answer();
    const unit = out.units[0];
    if (!unit) throw new Error("unit");
    const look = input.cinematographer.look_bible.look_line;
    const line =
      input.director.shots.find((s) => s.scene_id === "sc_1" && s.dialogue.length > 0)?.dialogue[0]
        ?.line ?? "";
    unit.prompt_text = unit.prompt_text
      .replace(look, "A different look.")
      .replace("@loc_1", "@loc_7")
      .replace(`"${line}"`, `"${line}" "${line}"`)
      .replace("END PROMPT", "The previous clip ended here.\nEND PROMPT");
    const errors = checkPrompter(out, input).join("\n");
    expect(errors).toContain("the look_line verbatim");
    expect(errors).toContain('"@loc_1" is missing');
    expect(errors).toContain('"@loc_7" is not an on-screen asset');
    expect(errors).toContain("must appear exactly once, in quotes (found 2)");
    expect(errors).toContain('uses "previous"');
    expect(errors).toContain('uses "clip"');
    const short = answer();
    const first = short.units[0];
    if (!first) throw new Error("unit");
    first.prompt_text = "BEGIN PROMPT\nStaging: x\nEND PROMPT";
    expect(checkPrompter(short, input).join("\n")).toMatch(/it needs at least 170/);
  });

  it("shot units: no Cut to, windows cover 0 to generate_s", () => {
    const i = shotModeInput();
    const out = answer(i);
    const unit = out.units[0];
    if (!unit) throw new Error("unit");
    unit.prompt_text = unit.prompt_text
      .replace(/\[0-(\d+)s\]/, "[1-$1s]")
      .replace("Action:", "Action: Cut to black.");
    const errors = checkPrompter(out, i).join("\n");
    expect(errors).toContain('has no "Cut to"');
    expect(errors).toContain("must run from 0 to");
  });

  it("units out of order or missing", () => {
    const out = answer();
    out.units.reverse();
    expect(checkPrompter(out, input).join("\n")).toContain("units must be exactly");
  });
});

describe("prompter dami", () => {
  it("runs on Sonnet with an Opus corrective retry", async () => {
    const bad = answer();
    bad.units = bad.units.slice(1);
    const client = new FakeClaudeClient([jsonResponse(bad), jsonResponse(answer())]);
    const result = await runDami(prompter, rawInput, {}, testDeps(client).deps);
    expect(client.requests.map((r) => r.model)).toEqual([CLAUDE_MODELS.sonnet, CLAUDE_MODELS.opus]);
    expect(result.output.units).toHaveLength(input.units.length);
  });

  it("the fixture's cinematographer shots are the sample's", () => {
    expect(input.cinematographer.shots.length).toBe(input.director.shots.length);
    expect(typeof sampleCinematographerShots).toBe("function");
  });
});
