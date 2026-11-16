import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { partText } from "../framework/define";
import { runDami } from "../framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import {
  assetDetector,
  checkDetection,
  detectorScriptText,
  evidenceItems,
  finalizeDetection,
  hasDialogue,
} from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import creativeBibleJson from "../creative-dna/fixtures/model-output.json";
import { creativeBibleSchema } from "../creative-dna/schema";
import { renderCreativeDna } from "../shared/creative-context";
import { ASSET_DETECTOR_SYSTEM } from "./prompt";
import {
  assetDetectorInputSchema,
  assetDetectorOutputSchema,
  type AssetDetectorOutput,
  type AssetDetectorParsedInput,
} from "./schema";

const input = assetDetectorInputSchema.parse(inputJson);
const output = assetDetectorOutputSchema.parse(outputJson);
const source = readFileSync(join(__dirname, "source", "asset_detector_dami_v2.md"), "utf8").replace(
  /\r\n/g,
  "\n",
);

function edit(change: (o: AssetDetectorOutput) => void): AssetDetectorOutput {
  const copy = structuredClone(output);
  change(copy);
  return copy;
}

function issuesOf(o: AssetDetectorOutput, i: AssetDetectorParsedInput = input): string[] {
  return checkDetection(o, i);
}

describe("asset-detector v2", () => {
  it("copies the owner's system prompt verbatim", () => {
    expect(ASSET_DETECTOR_SYSTEM.startsWith("# ROLE\nYou are the Asset Detector Dami")).toBe(true);
    expect(ASSET_DETECTOR_SYSTEM.endsWith("Keep each one short.")).toBe(true);
    expect(source).toContain(ASSET_DETECTOR_SYSTEM);
  });

  it("uses the owner's settings", () => {
    expect(assetDetector.key).toBe("asset-detector");
    expect(assetDetector.version).toBe("2.0.0");
    expect(assetDetector.model).toBe("claude-sonnet-5-5");
    expect(assetDetector.effort).toBe("low");
    expect(assetDetector.maxOutputTokens).toBe(32_000);
    expect(assetDetector.streaming).toBe(true);
  });

  it("builds one cached system block and the owner's <input> message", () => {
    const prompt = assetDetector.build(input);
    expect(prompt.system).toEqual([{ text: ASSET_DETECTOR_SYSTEM, cache: true }]);
    const user = partText(prompt.messages[0]?.content[0]);
    expect(user).toBe(`<input>\n${JSON.stringify(input, null, 2)}\n</input>`);
    // The script goes in unchanged.
    expect(JSON.parse(user.slice("<input>\n".length, -"\n</input>".length))).toEqual(input);
  });

  it("adds the Creative Bible slice as a second cached block, and leaves it out of <input>", () => {
    const bible = creativeBibleSchema.parse(creativeBibleJson);
    const creativeDna = renderCreativeDna("asset_detector", bible).text;
    const prompt = assetDetector.build({ ...input, creativeDna });
    expect(prompt.system).toEqual([
      { text: ASSET_DETECTOR_SYSTEM, cache: true },
      { text: creativeDna, cache: true },
    ]);
    expect(prompt.system.filter((b) => b.cache).length).toBeLessThanOrEqual(4);
    expect(partText(prompt.messages[0]?.content[0])).toBe(
      `<input>
${JSON.stringify(input, null, 2)}
</input>`,
    );
  });

  it("fixture output parses and passes every check", () => {
    expect(issuesOf(output)).toEqual([]);
    expect(finalizeDetection(output, input)).toBe(output);
  });

  it("runs end to end with a fake client, streaming, on Sonnet", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(assetDetector, input, {}, testDeps(client).deps);
    expect(result.output).toEqual(output);
    expect(client.methods).toEqual(["stream"]);
    expect(client.requests[0]?.model).toBe("claude-sonnet-5-5");
  });

  it("retries once with the issues when a check fails", async () => {
    const broken = edit((o) => {
      o.summary.prop_count = 9;
    });
    const client = new FakeClaudeClient([jsonResponse(broken), jsonResponse(outputJson)]);
    const result = await runDami(assetDetector, input, {}, testDeps(client).deps);
    expect(result.output).toEqual(output);
    expect(JSON.stringify(client.requests[1]?.messages)).toContain("summary.prop_count is 9");
  });

  it("verifies evidence against each scene's heading and text", () => {
    const text = detectorScriptText(input);
    expect(text.startsWith("EXT. HARBOUR PIER - DUSK\nWind whips")).toBe(true);
    expect(text).toContain("\n\nINT. FERRY CABIN - NIGHT\nWarm tungsten light.");
    const raw = assetDetectorInputSchema.parse({
      ...inputJson,
      script: { ...inputJson.script, scenes: undefined, raw_text: "INT. ROOM - DAY\n\nHello." },
    });
    expect(detectorScriptText(raw)).toBe("INT. ROOM - DAY\n\nHello.");
    const paths = evidenceItems(output).map((e) => e.path);
    expect(paths).toContain("char_1.facts[0]");
    expect(paths).toContain("loc_1.states[0]");
    expect(paths).toContain("loc_2.fixed_elements_from_script[1]");
    expect(paths).toContain("char_1.voice_hints[0]");
  });

  describe("validators", () => {
    it("1: summary counts equal the array lengths", () => {
      const issues = issuesOf(
        edit((o) => {
          o.summary.character_count = 3;
        }),
      );
      expect(issues).toEqual([
        "summary.character_count is 3 but characters has 2 entries; set it to 2",
      ]);
    });

    it("2: one scene_index entry per input scene, in order", () => {
      const missing = issuesOf(
        edit((o) => {
          o.scene_index.pop();
          o.summary.scene_count = 2;
        }),
      );
      expect(missing.some((i) => i.startsWith("scene_index is missing scene(s) 3"))).toBe(true);
      const reordered = issuesOf(
        edit((o) => {
          o.scene_index.reverse();
        }),
      );
      expect(reordered.some((i) => i.includes("in script order"))).toBe(true);
    });

    it("2: raw_text scenes are numbered 1, 2, 3 and anchors are found", () => {
      const raw = assetDetectorInputSchema.parse({
        ...inputJson,
        script: {
          ...inputJson.script,
          scenes: undefined,
          raw_text: input.script.scenes?.map((s) => `${s.heading}\n\n${s.text}`).join("\n\n"),
        },
      });
      const ok = edit((o) => {
        o.scene_index.forEach((s) => {
          s.anchor = s.heading;
        });
      });
      expect(issuesOf(ok, raw)).toEqual([]);
      const bad = edit((o) => {
        const first = o.scene_index[0];
        if (first) first.anchor = "A sentence the script never had.";
      });
      expect(issuesOf(bad, raw).some((i) => i.includes("the anchor is not in the script"))).toBe(
        true,
      );
    });

    it("3: every referenced id exists, ids are unique, first_scene is the earliest", () => {
      const issues = issuesOf(
        edit((o) => {
          o.scene_index[1]?.props_present.push("prop_9");
          const jonas = o.characters[1];
          if (jonas) jonas.relationships.push({ char_id: "char_7", relation: "brother of" });
          const pier = o.locations[0];
          if (pier) pier.first_scene = "3";
          o.diff.removed.push("prop_42");
        }),
      );
      expect(issues).toContain(
        'scene_index scene 2 props_present refers to prop "prop_9", which does not exist in this output',
      );
      expect(issues).toContain(
        'char_2.relationships refers to character "char_7", which does not exist in this output',
      );
      expect(issues).toContain('loc_1.first_scene is "3" but its earliest scene is "1"');
      // Removed ids are never flagged; full mode still wants an empty diff.
      expect(issues.some((i) => i.includes("prop_42"))).toBe(false);
      expect(issues).toContain(
        "in full mode diff.added, diff.updated and diff.removed must all be empty",
      );
    });

    it("3: a location state must belong to the scene's location", () => {
      const issues = issuesOf(
        edit((o) => {
          const cabin = o.scene_index[1];
          if (cabin) cabin.location_state_id = "loc_1_dark";
        }),
      );
      expect(issues).toContain(
        'scene_index scene 2: location_state_id "loc_1_dark" is not a state of loc_2',
      );
    });

    it("4: scene consistency, both ways", () => {
      const missingRef = issuesOf(
        edit((o) => {
          o.scene_index[2]?.characters_present.push("char_2");
        }),
      );
      expect(missingRef.some((i) => i.startsWith("char_2 is present"))).toBe(true);
      expect(missingRef.some((i) => i.includes("scene(s) 3 but they are missing"))).toBe(true);

      const extraRef = issuesOf(
        edit((o) => {
          const lantern = o.props[1];
          if (lantern) lantern.scene_refs.push("1");
        }),
      );
      expect(extraRef.some((i) => i.startsWith("prop_2.scene_refs lists scene(s) 1"))).toBe(true);

      // A character heard but not seen (heard_only) counts as in the scene.
      const voiceGone = issuesOf(
        edit((o) => {
          const last = o.scene_index[2];
          if (last) last.heard_only = [];
        }),
      );
      expect(voiceGone.some((i) => i.startsWith("char_1.scene_refs lists scene(s) 3"))).toBe(true);
    });

    it("4: every speaker is in the scene and speaks", () => {
      const issues = issuesOf(
        edit((o) => {
          const last = o.scene_index[2];
          // Jonas never speaks and is not in scene 3.
          if (last) last.speakers.push("char_2");
        }),
      );
      expect(issues).toContain(
        "scene_index scene 3: speaker char_2 is in neither characters_present nor heard_only; add it to one of them",
      );
      expect(issues).toContain(
        "scene_index scene 3: speaker char_2 has speaks false; set speaks true on the character or remove it from speakers",
      );
      const unknown = issuesOf(
        edit((o) => {
          o.scene_index[0]?.speakers.push("char_9");
        }),
      );
      expect(unknown).toContain(
        'scene_index scene 1 speakers refers to character "char_9", which does not exist in this output',
      );
    });

    it("6: a scene with dialogue needs a non-empty speakers list", () => {
      const issues = issuesOf(
        edit((o) => {
          const first = o.scene_index[0];
          if (first) first.speakers = [];
        }),
      );
      expect(issues).toEqual([
        "scene_index scene 1: the scene text has dialogue but speakers is empty; list every character who speaks in it",
      ]);
    });

    it("recognizes dialogue blocks and ignores action lines and transitions", () => {
      expect(hasDialogue("MARA\nWait.")).toBe(true);
      expect(hasDialogue("Rain.\n\nMARA (V.O.)\n(softly)\nYou were late.")).toBe(true);
      expect(hasDialogue("MARA (60s), wiry, hurries down the planks.")).toBe(false);
      expect(hasDialogue("Rain falls.\nIt does not stop.")).toBe(false);
      expect(hasDialogue("CUT TO:\nThe next room.")).toBe(false);
      expect(hasDialogue("")).toBe(false);
    });

    it("keeps a voice-only narrator as a character that is heard, not seen", () => {
      const o = edit((x) => {
        const mara = structuredClone(x.characters[0]);
        if (!mara) throw new Error("fixture changed");
        x.characters.push({
          ...mara,
          char_id: "char_3",
          name: "NARRATOR",
          name_latin: "Narrator",
          aliases: [],
          kind: "voice_only",
          needs_visual: false,
          facts: [],
          looks: [],
          voice_hints: [],
          scene_refs: ["3"],
          first_scene: "3",
        });
        const last = x.scene_index[2];
        if (last) last.heard_only.push("char_3");
        x.summary.character_count = 3;
      });
      expect(issuesOf(o)).toEqual([]);
    });

    it("7: duplicate names need same_person_as or a MERGE_CHECK warning", () => {
      const duplicate = edit((o) => {
        const jonas = o.characters[1];
        if (jonas) jonas.aliases.push("mara ");
      });
      expect(issuesOf(duplicate).some((i) => i.startsWith("characters char_1 and char_2"))).toBe(
        true,
      );
      const flagged = structuredClone(duplicate);
      flagged.warnings.push("MERGE_CHECK: char_1 and char_2 may be the same person (alias)");
      expect(issuesOf(flagged)).toEqual([]);
      // char_10 does not count as a mention of char_1.
      const wrongId = structuredClone(duplicate);
      wrongId.warnings.push("MERGE_CHECK: char_10 and char_2 may be the same person");
      expect(issuesOf(wrongId).length).toBe(1);
    });

    it("mode: fix needs applied_fixes, full and incremental forbid them", () => {
      const withFix = edit((o) => {
        o.applied_fixes.push({ code: "ADT05", target_ids: ["char_1"], change: "x" });
      });
      expect(issuesOf(withFix)).toContain("applied_fixes must be empty in full mode");
      const fixInput = assetDetectorInputSchema.parse({
        ...inputJson,
        mode: "fix",
        previous_output: outputJson,
        fix_requests: [
          { type: "technical", code: "ADT05", instruction: "Check.", target_ids: ["char_1"] },
        ],
      });
      const fixOutput = edit((o) => {
        o.mode = "fix";
      });
      expect(issuesOf(fixOutput, fixInput)).toEqual([
        "fix mode: list every request of fix_requests in applied_fixes as {code, target_ids, change}",
      ]);
    });

    it("caps the number of issues", () => {
      const issues = issuesOf(
        edit((o) => {
          for (let i = 0; i < 40; i++) o.scene_index[0]?.props_present.push(`prop_${100 + i}`);
        }),
      );
      expect(issues).toHaveLength(20);
      expect(issues.at(-1)).toMatch(/^\.\.\.and \d+ more issues/);
    });
  });

  describe("evidence (validator 5)", () => {
    it("more than 10% not found: one issue listing the paths", () => {
      const broken = edit((o) => {
        for (const c of o.characters) {
          for (const f of c.facts) f.evidence = `${f.evidence} (paraphrased)`;
        }
      });
      const issues = issuesOf(broken);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/^7 of 18 evidence excerpts are not in the script/);
      expect(issues[0]).toContain("char_1.facts[0]");
      expect(issues[0]).toContain("character for character");
    });

    it("10% or less: passes the check, finalize drops the items and records assumptions", async () => {
      // 1 of 18 items: a location state the scene index uses.
      const broken = edit((o) => {
        const state = o.locations[0]?.states[0];
        if (state) state.evidence = "The pier lies empty.";
      });
      expect(issuesOf(broken)).toEqual([]);
      const client = new FakeClaudeClient([jsonResponse(broken)]);
      const result = await runDami(assetDetector, input, {}, testDeps(client).deps);
      const final = result.output;
      expect(final.locations[0]?.states).toEqual([]);
      // The scene that used the dropped state no longer points at it.
      expect(final.scene_index[2]?.location_state_id).toBeNull();
      expect(final.assumptions.at(-1)).toBe("fact removed: evidence not found (loc_1.states[0])");
      expect(issuesOf(final)).toEqual([]);

      // A blank or paraphrased fact is dropped the same way.
      const fact = edit((o) => {
        const cap = o.characters[1]?.facts[2];
        if (cap) cap.evidence = "a tweed flat cap";
      });
      const dropped = finalizeDetection(fact, input);
      expect(dropped.characters[1]?.facts.map((f) => f.field)).toEqual(["age", "build"]);
      expect(dropped.assumptions.at(-1)).toBe("fact removed: evidence not found (char_2.facts[2])");
      expect(fact.characters[1]?.facts).toHaveLength(3);
    });

    it("matches Persian evidence typed with Arabic letters", () => {
      const persian = assetDetectorInputSchema.parse({
        ...inputJson,
        script: {
          ...inputJson.script,
          scenes: [
            {
              scene_number: "1",
              heading: "داخلی. آشپزخانه - شب",
              text: "مریم پشت میز نشسته است و نامه‌ای را می‌خواند.",
            },
          ],
        },
      });
      const arabicYeh = String.fromCharCode(0x064a);
      const evidence = `مر${arabicYeh}م پشت م${arabicYeh}ز نشسته است و نامهای`;
      const o = edit((x) => {
        x.scene_index = [
          {
            scene_number: "1",
            heading: "داخلی. آشپزخانه - شب",
            anchor: null,
            location_id: null,
            location_state_id: null,
            time_of_day: "night",
            characters_present: ["char_1"],
            char_looks: [],
            heard_only: [],
            speakers: [],
            props_present: [],
          },
        ];
        const maryam = structuredClone(output.characters[1]);
        if (!maryam) throw new Error("fixture changed");
        maryam.char_id = "char_1";
        maryam.name = "مریم";
        maryam.scene_refs = ["1"];
        maryam.first_scene = "1";
        maryam.facts = [{ field: "pose", value: "seated", status: "stated", scene: "1", evidence }];
        x.characters = [maryam];
        x.locations = [];
        x.props = [];
        x.summary = {
          scene_count: 1,
          character_count: 1,
          location_count: 0,
          prop_count: 0,
        };
      });
      expect(issuesOf(o, persian)).toEqual([]);
      expect(finalizeDetection(o, persian)).toBe(o);
    });
  });
});
