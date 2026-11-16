import { describe, expect, it } from "vitest";
import type { ProjectStyle } from "@/server/db/schema";
import { assetDetector, checkDetection } from "../asset-detector/dami";
import fixtureInput from "../asset-detector/fixtures/input.json";
import {
  assetDetectorInputSchema,
  assetDetectorOutputSchema,
  type AssetDetectorInput,
  type AssetDetectorOutput,
} from "../asset-detector/schema";
import { singleCallTarget, writerProject } from "../script-writer/project";
import { flattenForDetector, renderScreenplay } from "../shared/screenplay";
import { sampleAssetDetector } from "./asset-detector";
import { sampleScriptWriter } from "./script-writer";

const style: ProjectStyle = {
  visualStyle: "Cinematic live-action",
  genre: "Drama",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: 180,
};

const project = {
  format: "movie" as const,
  genre: "Drama",
  style: "Cinematic live-action",
  era_setting: null,
  ui_language: "en",
  sector: "wizard" as const,
};

const screenplay = sampleScriptWriter({
  mode: "generate",
  project: writerProject(style, singleCallTarget(style)),
  story: "An old fisherman named Tomas and his granddaughter Leyla find a map in a bottle.",
}).screenplay;

const script = { title: screenplay.title, logline: "A test script.", source: "generated" as const };

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

/** Runs the sample and asserts the output is valid and passes the dami's own checks. */
function detect(raw: AssetDetectorInput): AssetDetectorOutput {
  const output = sampleAssetDetector(raw);
  expect(assetDetectorOutputSchema.safeParse(output).success).toBe(true);
  const input = assetDetectorInputSchema.parse(raw);
  expect(checkDetection(output, input)).toEqual([]);
  expect(assetDetector.check(output, input)).toEqual([]);
  return output;
}

function full(): { input: AssetDetectorInput; output: AssetDetectorOutput } {
  const input: AssetDetectorInput = {
    mode: "full",
    project,
    script: { ...script, scenes: flattenForDetector({ screenplay }) },
  };
  return { input, output: detect(input) };
}

describe("sample asset detector", () => {
  it("reads a structured screenplay scene by scene", () => {
    const { output } = full();
    expect(output.scene_index.map((s) => s.scene_number)).toEqual(
      screenplay.scenes.map((s) => String(s.scene_number)),
    );
    expect(output.scene_index.every((s) => s.anchor === null)).toBe(true);
    expect(output.characters.map((c) => [c.char_id, c.name])).toEqual([
      ["char_1", "Leyla"],
      ["char_2", "Tomas"],
    ]);
    // "TOMAS (teens)" is a minor.
    expect(output.characters[1]?.is_minor).toBe("yes");
    expect(output.warnings).toContain("MINOR_PRESENT: char_2");
    expect(output.characters[0]?.facts[0]).toMatchObject({ field: "age", value: "30s" });
    expect(output.locations.map((l) => l.name)).toEqual([
      "Harbour Pier",
      "Lighthouse Gallery",
      "Ferry Cabin",
    ]);
    expect(output.locations[0]?.interior_exterior).toBe("exterior");
    expect(output.props.map((p) => p.name)).toEqual(["old radio", "paper map"]);
    expect(output.props[0]?.aliases).toEqual(["radio"]);
    expect(output.characters.map((c) => [c.char_id, c.speaks])).toEqual([
      ["char_1", true],
      ["char_2", true],
    ]);
    // Everyone who speaks in a scene is listed as its speaker; nobody is only heard here.
    expect(output.scene_index.every((s) => s.heard_only.length === 0)).toBe(true);
    expect(output.scene_index.some((s) => s.speakers.length > 0)).toBe(true);
    expect(output).not.toHaveProperty("voices");
    expect(output.diff).toEqual({ added: [], updated: [], removed: [] });
    expect(output.applied_fixes).toEqual([]);
  });

  it("is deterministic", () => {
    expect(full().output).toEqual(full().output);
  });

  it("passes the checks on the dami's own fixture input", () => {
    const output = detect(fixtureInput as AssetDetectorInput);
    expect(output.characters.map((c) => c.name)).toEqual(["Mara", "Jonas"]);
    const pier = output.locations[0];
    expect(pier?.times_of_day).toEqual(["dusk", "night"]);
    expect(pier?.states.map((s) => s.state_id)).toEqual(["loc_1_dusk", "loc_1_night"]);
    expect(output.props.map((p) => p.name)).toEqual(["brass locket", "lantern"]);
    // Mara is heard in voice-over only in scene 3.
    expect(output.scene_index[2]?.characters_present).toEqual([]);
    expect(output.scene_index[2]?.heard_only).toEqual(["char_1"]);
    expect(output.scene_index.map((s) => s.speakers)).toEqual([["char_1"], ["char_1"], ["char_1"]]);
    const mara = output.characters[0];
    expect(mara?.voice_delivery).toEqual(["on_screen", "voice_over"]);
    expect(mara?.voice_hints[0]?.evidence).toBe("(breathless)");
    expect(mara?.dialogue_language).toBe("English");
    // Jonas never speaks: no language, delivery or hints.
    expect(output.characters[1]).toMatchObject({
      speaks: false,
      dialogue_language: null,
      voice_delivery: [],
      voice_hints: [],
    });
  });

  it("splits a raw upload at its headings and anchors each scene", () => {
    const content = renderScreenplay({ screenplay }).text;
    const output = detect({
      mode: "full",
      project,
      script: { ...script, source: "uploaded", raw_text: content },
    });
    expect(output.scene_index.map((s) => s.scene_number)).toEqual(["1", "2", "3"]);
    expect(output.scene_index[0]?.anchor).toBe("EXT. HARBOUR PIER - DUSK LEYLA (30s), wiry");
    expect(output.characters).toHaveLength(2);
  });

  it("reads one scene when a raw upload has no headings", () => {
    const output = detect({
      mode: "full",
      project,
      script: { ...script, source: "uploaded", raw_text: "MARA\nHello?\n\nNobody answers." },
    });
    expect(output.scene_index).toHaveLength(1);
    expect(output.scene_index[0]?.location_id).toBeNull();
    expect(output.warnings).toContain("NO_LOCATION: scene 1 has no stated place");
    expect(output.characters[0]?.name).toBe("Mara");
  });

  it("reads a Persian script", () => {
    const output = detect({
      mode: "full",
      project: { ...project, ui_language: "fa" },
      script: { ...script, source: "uploaded", raw_text: PERSIAN_SCRIPT },
    });
    expect(output.characters.map((c) => c.name)).toEqual(["مریم", "رضا"]);
    expect(output.characters.every((c) => /^[\x20-\x7e]+$/.test(c.name_latin))).toBe(true);
    expect(output.locations.map((l) => [l.name, l.interior_exterior, l.time_of_day])).toEqual([
      ["آشپزخانه", "interior", "night"],
      ["حیاط", "exterior", "dawn"],
    ]);
    expect(output.props.map((p) => p.name_latin)).toEqual(["oil lamp", "letter", "suitcase"]);
    expect(output.characters.map((c) => c.dialogue_language)).toEqual(["Persian", "Persian"]);
    expect(output.characters[0]?.ui_summary).toContain("شخصیت");
  });

  it("keeps known ids in incremental mode and reports the diff", () => {
    const { input } = full();
    const output = detect({
      ...input,
      mode: "incremental",
      known_assets: [
        { id: "char_5", status: "approved", entry: { name: "LEYLA", scene_refs: ["1"] } },
        { id: "char_9", status: "detected", entry: { name: "Ghost" } },
        { id: "loc_3", status: "in_progress", entry: { name: "Harbour Pier", aliases: [] } },
      ],
    });
    const leyla = output.characters.find((c) => c.char_id === "char_5");
    expect(leyla?.name).toBe("LEYLA");
    // New ids continue after the highest known id of each type.
    expect(output.characters.map((c) => c.char_id)).toEqual(["char_5", "char_10"]);
    expect(output.locations.map((l) => l.loc_id)).toEqual(["loc_3", "loc_4", "loc_5"]);
    expect(output.diff.added).toContain("char_10");
    expect(output.diff.updated).toContain("char_5");
    expect(output.diff.removed).toEqual(["char_9"]);
  });

  describe("fix mode", () => {
    function fix(
      previous: AssetDetectorOutput,
      base: AssetDetectorInput,
      requests: NonNullable<AssetDetectorInput["fix_requests"]>,
    ): AssetDetectorOutput {
      return detect({ ...base, mode: "fix", previous_output: previous, fix_requests: requests });
    }

    it("ADT01 adds something the script names, or warns NOT_IN_SCRIPT", () => {
      const { input, output } = full();
      const fixed = fix(output, input, [
        {
          type: "technical",
          code: "ADT01",
          instruction: "Something is missing.",
          target_ids: [],
          custom_text: "window",
        },
        {
          type: "technical",
          code: "ADT01",
          instruction: "Something is missing.",
          target_ids: [],
          custom_text: "a dragon",
        },
      ]);
      const window = fixed.props.find((p) => p.name === "window");
      expect(window?.prop_id).toBe("prop_3");
      expect(fixed.diff.added).toEqual(["prop_3"]);
      expect(fixed.warnings).toContain("NOT_IN_SCRIPT: a dragon");
      expect(fixed.applied_fixes.map((f) => f.code)).toEqual(["ADT01", "ADT01"]);
      // Everything else stays as it was.
      expect(fixed.characters).toEqual(output.characters);
    });

    it("ADT01 adds a speaking character with its voice facts", () => {
      const input: AssetDetectorInput = {
        mode: "full",
        project,
        script: {
          ...script,
          raw_text: "INT. ROOM - DAY\n\nANNA sits.\n\nANNA\nHi.\n\nBEN (O.S.)\nHello?",
        },
      };
      const output = detect(input);
      const without = structuredClone(output);
      without.characters = without.characters.filter((c) => c.name !== "Ben");
      without.scene_index.forEach((s) => {
        s.heard_only = [];
        s.speakers = s.speakers.filter((id) => id !== "char_2");
      });
      without.summary.character_count = 1;
      const fixed = fix(without, input, [
        {
          type: "technical",
          code: "ADT01",
          instruction: "Ben is missing.",
          target_ids: [],
          custom_text: "Ben",
        },
      ]);
      // char_2 was dropped without a trace in diff.removed, so its number is free again.
      const ben = fixed.characters.find((c) => c.name === "Ben");
      expect(ben?.char_id).toBe("char_2");
      expect(ben?.kind).toBe("voice_only");
      expect(ben?.needs_visual).toBe(false);
      expect(ben?.voice_delivery).toEqual(["off_screen"]);
      expect(ben?.dialogue_language).toBe("English");
      expect(fixed.scene_index[0]?.heard_only).toEqual(["char_2"]);
      expect(fixed.scene_index[0]?.speakers).toEqual(["char_1", "char_2"]);
      expect(fixed.diff.added).toEqual(["char_2"]);
    });

    it("ADT02 merges duplicates into the lowest id", () => {
      const { input, output } = full();
      const fixed = fix(output, input, [
        {
          type: "technical",
          code: "ADT02",
          instruction: "Same person.",
          target_ids: ["char_2", "char_1"],
        },
      ]);
      expect(fixed.characters.map((c) => c.char_id)).toEqual(["char_1"]);
      expect(fixed.characters[0]?.aliases).toEqual(["Tomas"]);
      expect(fixed.diff.removed).toEqual(["char_2"]);
      // The merged character's speaker entries point at the kept id, once.
      expect(fixed.scene_index.every((s) => !s.speakers.includes("char_2"))).toBe(true);
      expect(fixed.characters[0]?.dialogue_line_count).toBe(
        output.characters.reduce((n, c) => n + c.dialogue_line_count, 0),
      );
      expect(fixed.diff.updated).toEqual(["char_1"]);
      expect(fixed.applied_fixes).toEqual([
        { code: "ADT02", target_ids: ["char_1", "char_2"], change: "merged char_2 into char_1" },
      ]);
    });

    it("ADT04 moves an asset to another category with a new id", () => {
      const { input, output } = full();
      const fixed = fix(output, input, [
        {
          type: "technical",
          code: "ADT04",
          instruction: "Wrong category.",
          target_ids: ["prop_1"],
          custom_text: "character",
        },
      ]);
      expect(fixed.props.map((p) => p.prop_id)).toEqual(["prop_2"]);
      const moved = fixed.characters.find((c) => c.char_id === "char_3");
      expect(moved?.name).toBe("old radio");
      expect(fixed.diff).toEqual({ added: ["char_3"], updated: [], removed: ["prop_1"] });
      expect(fixed.scene_index.some((s) => s.props_present.includes("prop_1"))).toBe(false);
    });

    it("records other codes without changing the entries", () => {
      const { input, output } = full();
      const fixed = fix(output, input, [
        {
          type: "preference",
          code: "ADP99",
          instruction: "Make it nicer.",
          target_ids: ["char_1"],
        },
        { type: "technical", code: "ADT06", instruction: "Scenes.", target_ids: ["prop_2"] },
      ]);
      expect(fixed.applied_fixes.map((f) => f.code)).toEqual(["ADP99", "ADT06"]);
      expect(fixed.characters).toEqual(output.characters);
      expect(fixed.props).toEqual(output.props);
    });
  });
});
