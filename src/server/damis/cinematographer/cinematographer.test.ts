import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { partText } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { countBreakpoints, outputFormatFor } from "../framework/request";
import { runDami } from "../framework/runner";
import {
  sampleCinematographerLook,
  sampleCinematographerRelight,
  sampleCinematographerShots,
} from "../sample/cinematographer-v1";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { cinematographerLook, cinematographerRelight, cinematographerShots } from "./dami";
import rawLook from "./fixtures/look-input.json";
import rawRelight from "./fixtures/relight-input.json";
import rawShots from "./fixtures/shots-input.json";
import {
  CINEMATOGRAPHER_IDS,
  CINEMATOGRAPHERS,
  cinematographerCard,
  cinematographerStyleCard,
  isCardMode,
} from "./library";
import { buildCinematographerV1Prompt, CINEMATOGRAPHER_STYLE_CARD_INSTRUCTION } from "./prompt";
import { CINEMATOGRAPHER_SYSTEM } from "./prompt-text";
import {
  cinematographerLookInputSchema,
  cinematographerRelightInputSchema,
  cinematographerShotsInputSchema,
  cinematographerShotsOutputSchema,
  lookOutputSchema,
  relightOutputSchema,
} from "./schema";
import { checkCinematographerShots, checkLook, checkPhrase, checkRelight } from "./validate";

const lookJson = rawLook as unknown as z.input<typeof cinematographerLookInputSchema>;
const shotsJson = rawShots as unknown as z.input<typeof cinematographerShotsInputSchema>;
const relightJson = rawRelight as unknown as z.input<typeof cinematographerRelightInputSchema>;
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const lookInput = cinematographerLookInputSchema.parse(lookJson);
const shotsInput = cinematographerShotsInputSchema.parse(shotsJson);
const relightInput = cinematographerRelightInputSchema.parse(relightJson);
const look = () => structuredClone(lookOutputSchema.parse(sampleCinematographerLook(lookJson)));
const shots = () =>
  structuredClone(cinematographerShotsOutputSchema.parse(sampleCinematographerShots(shotsJson)));
const SURNAMES = ["Deakins", "Doyle", "Delbonnel", "Willis", "Lubezki", "Storaro"];

describe("cinematographer sources", () => {
  it("the system prompt is the owner's CINEMATOGRAPHER v1.0 from <role> to the end, verbatim", () => {
    const source = lf(
      readFileSync(join(__dirname, "source", "dami_cinematographer.system.md"), "utf8"),
    );
    expect(CINEMATOGRAPHER_SYSTEM).toBe(source.slice(source.indexOf("<role>")).trimEnd());
    expect(source.split("\n")[1]).toContain("v1.0");
    expect(CINEMATOGRAPHER_SYSTEM.endsWith("</code_side_validator>")).toBe(true);
  });

  it("every DP card is the owner's source file, verbatim", () => {
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
      for (const mode of card.modes)
        expect(section.toLowerCase()).toContain(mode.name.toLowerCase());
      expect(isCardMode(card.id, card.defaultModeId)).toBe(true);
    }
  });

  it("the style card is Rule 2 with its Modes, without the title, Rule 1, Rule 3 or the DP's name", () => {
    for (const id of CINEMATOGRAPHER_IDS) {
      const card = cinematographerStyleCard(id);
      expect(card.startsWith("## Rule 2")).toBe(true);
      expect(card).toContain("### Modes");
      expect(card).not.toContain("## Rule 1");
      expect(card).not.toContain("## Rule 3");
      expect(cinematographerCard(id).system).toContain(card);
      for (const name of SURNAMES) expect(card).not.toContain(name);
    }
  });
});

describe("cinematographer prompt", () => {
  it("sends the owner's prompt, the DP card with the precedence rule, the project, then the call", () => {
    const prompt = buildCinematographerV1Prompt(lookInput);
    expect(partText(prompt.system[0])).toBe(CINEMATOGRAPHER_SYSTEM);
    const [card, project, call] = prompt.messages[0]?.content ?? [];
    expect(partText(card)).toContain(
      `<cinematographer_style_card>\n${cinematographerStyleCard("deakins")}\n</cinematographer_style_card>`,
    );
    expect(partText(card)).toContain(CINEMATOGRAPHER_STYLE_CARD_INSTRUCTION);
    expect(CINEMATOGRAPHER_STYLE_CARD_INSTRUCTION).toContain("Rule 1 still holds");
    expect(CINEMATOGRAPHER_STYLE_CARD_INSTRUCTION).toContain("the bible and the director win");
    expect(partText(project)).toContain("<director_output>");
    expect(partText(project)).not.toContain('"shots"');
    expect(partText(call)).toContain("<director_shots>");
    expect(countBreakpoints(prompt)).toBe(3);
  });

  it("shots mode caches the look bible and sends only the range's shots", () => {
    const one = cinematographerShotsInputSchema.parse({ ...shotsJson, scene_range: "sc_2" });
    const prompt = buildCinematographerV1Prompt(one);
    expect(countBreakpoints(prompt)).toBe(4);
    const call = partText(prompt.messages[0]?.content[3]);
    expect(call).not.toContain('"scene_id":"sc_1"');
    expect(call).toContain('"scene_id":"sc_2"');
  });

  it("each mode's output schema is a valid structured-output schema", () => {
    for (const schema of [
      lookOutputSchema,
      cinematographerShotsOutputSchema,
      relightOutputSchema,
    ]) {
      expect(() => outputFormatFor(schema)).not.toThrow();
    }
  });
});

describe("cinematographer samples pass their checks and never name the DP", () => {
  it("look, shots, relight", () => {
    const l = look();
    expect(checkLook(l, lookInput)).toEqual([]);
    expect(checkCinematographerShots(shots(), shotsInput)).toEqual([]);
    const r = relightOutputSchema.parse(sampleCinematographerRelight(relightJson));
    expect(r.changed_setups.length).toBeGreaterThan(0);
    expect(checkRelight(r, relightInput)).toEqual([]);
    for (const text of [JSON.stringify(l), JSON.stringify(shots()), JSON.stringify(r)]) {
      for (const name of SURNAMES) expect(text).not.toContain(name);
    }
  });
});

describe("cinematographer checks", () => {
  it("look: word limits, a missing setup and forbidden words", () => {
    const l = look();
    const setup = l.look_bible.light_setups[0];
    if (!setup) throw new Error("setup");
    setup.light_line =
      "Same as before, a 35mm ARRI glow with lens flares in the room, falling toward darkness here.";
    l.look_bible.light_setups = [setup];
    const errors = checkLook(
      { ...l, look_bible: { ...l.look_bible, look_line: "Too short." } },
      lookInput,
    ).join("\n");
    expect(errors).toContain("look_line: 2 words");
    expect(errors).toContain('"Same as" points outside');
    expect(errors).toContain('"35mm" is a bare focal length');
    expect(errors).toContain('"ARRI" is a brand name');
    expect(errors).toContain('forbidden look "lens flares"');
    expect(errors).toMatch(/no setup for loc_\d at/);
  });

  it("the colour red is not the RED brand", () => {
    expect(checkPhrase("p", "a red rim on her cheek", [0, 14], [])).toEqual([]);
    expect(checkPhrase("p", "shot on RED", [0, 14], [])).toEqual(['p: "RED" is a brand name']);
  });

  it("shots: wrong ids, unknown light, static with movement, continuous chains", () => {
    const s = shots();
    const [a, b] = s.shots;
    if (!a || !b) throw new Error("shots");
    a.light_id = "loc_9_day";
    const staticShot = s.shots.find(
      (x) =>
        shotsInput.director_output.shots.find((d) => d.shot_id === x.shot_id)
          ?.camera_move_intent === "static",
    );
    if (!staticShot) throw new Error("static");
    staticShot.support = "dolly";
    staticShot.speed = "slow";
    s.shots = s.shots.slice(0, -1);
    const errors = checkCinematographerShots(s, shotsInput).join("\n");
    expect(errors).toContain("exactly the shot_ids of the range");
    expect(errors).toContain('light_id "loc_9_day" is not in the look bible');
    expect(errors).toContain('a static shot needs support locked or tripod and speed "none"');

    const continuous = structuredClone(shotsInput);
    const d0 = continuous.director_output.shots[0];
    if (!d0) throw new Error("shot");
    d0.transition_after = "continuous";
    const s2 = shots();
    const second = s2.shots[1];
    if (!second) throw new Error("shot");
    second.lens_family = "macro";
    expect(checkCinematographerShots(s2, continuous).join("\n")).toContain(
      "a continuous take keeps the same lens_family",
    );
  });

  it("relight: another location, an unknown setup, a shot elsewhere", () => {
    const r = relightOutputSchema.parse(sampleCinematographerRelight(relightJson));
    const setup = r.changed_setups[0];
    if (!setup) throw new Error("setup");
    r.changed_setups.push({ ...setup, light_id: "loc_2_noon" });
    r.affected_shot_ids.push(shotsInput.director_output.shots[0]?.shot_id ?? "");
    const errors = checkRelight(r, relightInput).join("\n");
    expect(errors).toContain('"loc_2_noon" is not a setup of the look bible');
    expect(errors).toContain("is not a shot at loc_2");
  });

  it("a rejected bible must block", () => {
    const rejected = cinematographerLookInputSchema.parse({
      ...lookJson,
      creative_bible: { ...lookInput.creative_bible, validation_status: "rejected" },
    });
    expect(checkLook(look(), rejected)[0]).toContain('answer with status "blocked"');
    expect(
      checkLook(lookOutputSchema.parse(sampleCinematographerLook(rejected)), rejected),
    ).toEqual([]);
  });
});

describe("cinematographer damis", () => {
  it("look on Opus, shots on Sonnet with an Opus corrective retry, relight on Opus", async () => {
    const lc = new FakeClaudeClient([jsonResponse(look())]);
    await runDami(cinematographerLook, lookJson, {}, testDeps(lc).deps);
    expect(lc.requests[0]?.model).toBe(CLAUDE_MODELS.opus);

    const bad = shots();
    bad.shots = bad.shots.slice(1);
    const sc = new FakeClaudeClient([jsonResponse(bad), jsonResponse(shots())]);
    const result = await runDami(cinematographerShots, shotsJson, {}, testDeps(sc).deps);
    expect(sc.requests.map((r) => r.model)).toEqual([CLAUDE_MODELS.sonnet, CLAUDE_MODELS.opus]);
    expect(result.model).toBe(CLAUDE_MODELS.opus);

    const rc = new FakeClaudeClient([jsonResponse(sampleCinematographerRelight(relightJson))]);
    await runDami(cinematographerRelight, relightJson, {}, testDeps(rc).deps);
    expect(rc.requests[0]?.model).toBe(CLAUDE_MODELS.opus);
  });
});
