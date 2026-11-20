import { describe, expect, it } from "vitest";
import {
  defaultPlatformConfig,
  type AssetRegistry,
  type FilmDirectorBlockMode,
  type FilmShot,
  type ShotPlan,
  type ShotStaging,
} from "@/server/damis";
import { checkHeardOnly, checkStagingContinuity } from "@/server/damis/director/validate";
import {
  allotSeconds,
  breakdown,
  splitWindows,
  toStaging,
  type BreakdownResult,
} from "./breakdown";

const registry: AssetRegistry = {
  characters: [
    { char_id: "char_1", name: "Nora", script_description: "", speaks: true },
    { char_id: "char_2", name: "Lina", script_description: "", speaks: true },
  ],
  locations: [
    { loc_id: "loc_1", name: "Kitchen", script_description: "" },
    { loc_id: "loc_2", name: "Front step", script_description: "" },
  ],
  props: [{ prop_id: "prop_1", name: "Key", script_description: "" }],
  scene_index: [
    { scene_number: "1", heading: "INT. KITCHEN - EVENING", characters_present: [] },
    { scene_number: "2", heading: "EXT. FRONT STEP - NIGHT", characters_present: [] },
    { scene_number: "3", heading: "INT. KITCHEN - LATER", characters_present: [] },
  ],
};

function staging(id: string, extra: Partial<ShotStaging> = {}): ShotStaging {
  return {
    character_id: id,
    on_screen: true,
    frame_position: id === "char_1" ? "frame-left" : "frame-right",
    depth: "midground",
    facing: "three-quarter toward the other",
    head: "level",
    eyeline: "at the other",
    sees: [],
    posture: "standing",
    relation: "two steps apart",
    ...extra,
  };
}

let counter = 0;

/** A shot of `seconds` in `scene` (sc_1 → loc_1, sc_2 → loc_2, sc_3 → loc_1). */
function shot(
  scene: string,
  seconds: number,
  extra: Partial<FilmShot> & { beat?: string; words?: number } = {},
): FilmShot {
  counter += 1;
  const { beat, words, ...rest } = extra;
  const line = words ? Array.from({ length: words }, (_, i) => `w${i}`).join(" ") : "";
  return {
    shot_id: `s${counter}`,
    scene_id: scene,
    beat_ids: [beat ?? `b${counter}`],
    duration_s: seconds,
    size: "medium",
    camera: {
      position: "south side",
      height: "eye level",
      angle: "three-quarter",
      movement: "locked off",
      background: "the north wall",
    },
    staging: [staging("char_1")],
    props: [],
    action: `Action of shot ${counter}.`,
    dialogue: line
      ? [{ speaker_id: "char_1", line, delivery: "quiet", language: "en", heard_as: "on_screen" }]
      : [],
    sound: "room tone",
    cut_reason: `cut ${counter}`,
    start_state: `start of ${counter}`,
    end_state: `end of ${counter}`,
    script_quote: { start: `start ${counter}`, end: `end ${counter}` },
    ...rest,
  };
}

function plan(shots: FilmShot[]): Pick<ShotPlan, "shots" | "beats" | "scene_geography"> {
  const scenes = [...new Set(shots.map((s) => s.scene_id))];
  return {
    shots: shots.map((s, i) => ({ ...s, shot_id: `s${i + 1}` })),
    beats: [...new Set(shots.flatMap((s) => s.beat_ids))].map((id) => ({
      beat_id: id,
      scene_id: shots.find((s) => s.beat_ids.includes(id))?.scene_id ?? "sc_1",
      summary: `Beat ${id}.`,
      must_survive: true,
    })),
    scene_geography: scenes.map((id) => ({
      scene_id: id,
      location_id: id === "sc_2" ? "loc_2" : "loc_1",
      layout: "",
      camera_side: "",
      screen_direction: "",
      starting_positions: [],
    })),
  };
}

function run(shots: FilmShot[], blockMode: FilmDirectorBlockMode = "fixed_15"): BreakdownResult {
  return breakdown({
    plan: plan(shots),
    blockMode,
    platform: defaultPlatformConfig(),
    registry,
    language: "en",
  });
}

/** Windows are contiguous from 0, 2 to 6 s each, and end at the block's length. */
function expectExactWindows(result: BreakdownResult): void {
  result.shotsByBlock.forEach((b, i) => {
    const length = result.blocks[i]?.duration_s;
    let cursor = 0;
    for (const w of b.windows) {
      expect(w.from_s).toBe(cursor);
      expect(w.to_s - w.from_s).toBeGreaterThanOrEqual(2);
      expect(w.to_s - w.from_s).toBeLessThanOrEqual(6);
      expect(Number.isInteger(w.to_s)).toBe(true);
      cursor = w.to_s;
    }
    expect(cursor).toBe(length);
    // Windows follow the block's shots in order; a shot's windows are consecutive.
    const order = [...new Set(b.windows.map((w) => w.shot_id))];
    expect(order).toEqual(b.shot_ids);
  });
}

const ids = (r: BreakdownResult) => r.shotsByBlock.map((b) => b.shot_ids);

describe("allotSeconds and splitWindows", () => {
  it("scales to an exact whole-second total, each at least the minimum", () => {
    expect(allotSeconds([3, 3, 3], 15, 2)).toEqual([5, 5, 5]);
    expect(allotSeconds([4, 6], 15, 2)).toEqual([6, 9]);
    const out = allotSeconds([1, 10, 10], 15, 2);
    expect(out.reduce((s, d) => s + d, 0)).toBe(15);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(2);
  });

  it("splits a long shot into even windows of at most 6 s", () => {
    expect(splitWindows(5)).toEqual([5]);
    expect(splitWindows(7)).toEqual([4, 3]);
    expect(splitWindows(15)).toEqual([5, 5, 5]);
    expect(splitWindows(30)).toEqual([6, 6, 6, 6, 6]);
  });
});

describe("breakdown", () => {
  it("fixed modes: exact block lengths, exact window sums, no split shots, script order", () => {
    const shots = [
      shot("sc_1", 4, { beat: "a" }),
      shot("sc_1", 5, { beat: "a" }),
      shot("sc_1", 6, { beat: "b" }),
      shot("sc_1", 3, { beat: "c" }),
      shot("sc_1", 4, { beat: "c" }),
      shot("sc_1", 7, { beat: "d" }),
    ];
    for (const mode of ["fixed_15", "fixed_30"] as const) {
      const r = run(shots, mode);
      expect(r.blocks.every((b) => b.duration_s === (mode === "fixed_15" ? 15 : 30))).toBe(true);
      expect(r.blocks.map((b) => b.block_id)).toEqual(r.blocks.map((_, i) => i + 1));
      expect(ids(r).flat()).toEqual(shots.map((_, i) => `s${i + 1}`));
      expectExactWindows(r);
    }
  });

  it("prefers block breaks at scene changes", () => {
    const r = run([
      shot("sc_1", 5),
      shot("sc_1", 5, { beat: "b1" }),
      shot("sc_1", 5, { beat: "b1" }),
      shot("sc_2", 5, { beat: "b2" }),
      shot("sc_2", 5, { beat: "b2" }),
      shot("sc_2", 5),
    ]);
    expect(ids(r)).toEqual([
      ["s1", "s2", "s3"],
      ["s4", "s5", "s6"],
    ]);
    expect(r.blocks[1]?.continuity.type).toBe("new_scene");
    expect(r.blocks.map((b) => b.scene_ids)).toEqual([["sc_1"], ["sc_2"]]);
    expect(r.blocks.map((b) => b.assets.locations)).toEqual([["loc_1"], ["loc_2"]]);
    expect(r.blocks[0]?.scene_heading).toBe("INT. KITCHEN - EVENING");
  });

  it("only a whole scene under 8 s shares a block with the next one", () => {
    const short = run([
      shot("sc_1", 3, { beat: "x" }),
      shot("sc_2", 4, { beat: "y" }),
      shot("sc_2", 4, { beat: "y" }),
      shot("sc_2", 4, { beat: "y" }),
    ]);
    expect(ids(short)).toEqual([["s1", "s2", "s3", "s4"]]);
    expect(short.blocks[0]?.scene_ids).toEqual(["sc_1", "sc_2"]);
    expect(short.blocks[0]?.scene_heading).toBe("INT. KITCHEN - EVENING / EXT. FRONT STEP - NIGHT");

    const long = run([
      shot("sc_1", 5, { beat: "x" }),
      shot("sc_1", 5, { beat: "x" }),
      shot("sc_2", 3, { beat: "y" }),
      shot("sc_2", 2, { beat: "y" }),
    ]);
    expect(long.blocks.every((b) => b.scene_ids.length === 1)).toBe(true);
  });

  it("keeps events, spoken words and the shot limit per block", () => {
    // Three beats of 5 s: at most two events in 15 s.
    const events = run([shot("sc_1", 5), shot("sc_1", 5), shot("sc_1", 5)]);
    expect(events.blocks.every((b) => b.budgets.events <= 2)).toBe(true);
    expect(events.blocks.length).toBe(2);

    // 20 words each: the 15 s ceiling is 26 words (2.5 wps x 15 x 0.7).
    const words = run([
      shot("sc_1", 5, { beat: "a", words: 20 }),
      shot("sc_1", 5, { beat: "a", words: 20 }),
    ]);
    expect(ids(words)).toEqual([["s1"], ["s2"]]);
    expect(words.blocks.every((b) => b.budgets.spoken_words <= b.budgets.spoken_words_max)).toBe(
      true,
    );
    expect(words.blocks[0]?.budgets.spoken_words_max).toBe(26);

    // Eight 2 s shots of one beat: at most five shots per 15 s block (rapid cut).
    const rapid = run(Array.from({ length: 8 }, () => shot("sc_1", 2, { beat: "r" })));
    expect(rapid.shotsByBlock.every((b) => b.shot_ids.length <= 5)).toBe(true);
    const budgets = rapid.blocks.map((b) => b.budgets.shot_budget);
    rapid.blocks.forEach((b, i) => {
      expect(budgets[i]).toBe(
        (rapid.shotsByBlock[i]?.shot_ids.length ?? 0) > 3 ? "rapid_cut" : "standard",
      );
      if (b.budgets.shot_budget === "rapid_cut") expect(b.editing_rationale).toMatch(/Rapid/);
    });
    expectExactWindows(rapid);
  });

  it("plays a long shot over windows of the same shot, and clamps one longer than its block", () => {
    const long = run([shot("sc_1", 14)]);
    expect(long.shotsByBlock[0]?.windows).toEqual([
      { shot_id: "s1", from_s: 0, to_s: 5 },
      { shot_id: "s1", from_s: 5, to_s: 10 },
      { shot_id: "s1", from_s: 10, to_s: 15 },
    ]);
    const clamped = run([shot("sc_1", 22)]);
    expect(clamped.blocks[0]?.duration_s).toBe(15);
    expect(clamped.warnings.some((w) => w.ref === "s1" && /clamped/.test(w.message))).toBe(true);
    expectExactWindows(clamped);
  });

  it("auto: 30 s for a 4-beat moment in one scene, 15 s otherwise", () => {
    const moment = run(
      [
        shot("sc_1", 7, { beat: "a" }),
        shot("sc_1", 7, { beat: "b" }),
        shot("sc_1", 7, { beat: "c" }),
        shot("sc_1", 7, { beat: "d" }),
      ],
      "auto",
    );
    expect(moment.blocks.map((b) => b.duration_s)).toEqual([30]);
    const short = run([shot("sc_1", 7, { beat: "a" }), shot("sc_1", 7, { beat: "a" })], "auto");
    expect(short.blocks.map((b) => b.duration_s)).toEqual([15]);
    const across = run(
      [
        shot("sc_1", 7, { beat: "a" }),
        shot("sc_1", 7, { beat: "b" }),
        shot("sc_2", 7, { beat: "c" }),
        shot("sc_2", 7, { beat: "d" }),
      ],
      "auto",
    );
    expect(across.blocks.every((b) => b.duration_s === 15)).toBe(true);
    expectExactWindows(across);
  });

  it("refuses shot mode (not writable yet)", () => {
    expect(() => run([shot("sc_1", 5)], "shot")).toThrow(/shot-by-shot/);
  });

  it("maps staging to v1.4 and links blocks of one scene by a hard cut", () => {
    const st = toStaging(staging("char_1", { relation: "beside the table" }));
    expect(st).toEqual({
      character_id: "char_1",
      on_screen: true,
      position: "frame-left, midground; beside the table",
      posture: "standing",
      facing: "three-quarter toward the other",
      gaze: "level, at the other",
      screen_side: "frame-left",
      distances: [],
    });
    expect(toStaging(staging("char_2", { frame_position: "off-screen" })).screen_side).toBe(
      "background",
    );

    const shots = [
      shot("sc_1", 5, { beat: "a", staging: [staging("char_1")] }),
      shot("sc_1", 5, { beat: "a", staging: [staging("char_1"), staging("char_2")] }),
      shot("sc_1", 5, { beat: "b" }),
      shot("sc_1", 5, {
        beat: "c",
        staging: [staging("char_2", { posture: "sitting" }), staging("char_1")],
      }),
      shot("sc_1", 5, { beat: "c" }),
      shot("sc_1", 5, { beat: "d" }),
    ];
    const r = run(shots);
    expect(r.blocks).toHaveLength(2);
    const [first, second] = r.blocks;
    if (!first || !second) throw new Error("two blocks");
    // char_2 enters in the second shot: staged at the start, but off screen.
    expect(first.assets.characters).toEqual(["char_1", "char_2"]);
    expect(first.start_staging.map((s) => [s.character_id, s.on_screen])).toEqual([
      ["char_1", true],
      ["char_2", false],
    ]);
    expect(first.continuity.type).toBe("first");
    expect(second.continuity.type).toBe("hard_cut");
    expect(second.continuity.use_last_frame_as_start).toBe(false);
    expect(checkStagingContinuity(second, first)).toEqual([]);
    expect(first.opening_frame).toBe(r.blocks[0]?.start_state);
    expect(first.script_coverage).toEqual({
      start_quote: shots[0]?.script_quote.start,
      end_quote: shots[2]?.script_quote.end,
    });
  });

  it("a speaker who is not on screen is heard only: no staging, not in characters", () => {
    const r = run([
      shot("sc_1", 7, {
        beat: "a",
        staging: [staging("char_1"), staging("char_2", { on_screen: false })],
        dialogue: [
          {
            speaker_id: "char_2",
            line: "Come home.",
            delivery: "through the door",
            language: "en",
            heard_as: "off_screen",
          },
        ],
        props: [{ prop_id: "prop_1", holder_id: "char_1", hand: "left", placement: "in hand" }],
      }),
      shot("sc_1", 7, { beat: "a" }),
    ]);
    const block = r.blocks[0];
    if (!block) throw new Error("one block");
    expect(block.assets.characters).toEqual(["char_1"]);
    expect(block.assets.heard_only).toEqual(["char_2"]);
    expect(block.assets.props).toEqual(["prop_1"]);
    expect(block.start_staging.map((s) => s.character_id)).toEqual(["char_1"]);
    expect(checkHeardOnly(block)).toEqual([]);
  });
});
