/**
 * The Breakdown (step 3 of the craft pipeline, code, no Claude call): groups the film-director's
 * shots into the 15 or 30 second blocks the video model generates, times every shot inside its
 * block, and maps each block onto a Director v1.4 plan block, so the v1.4 writer
 * (`write_blocks`) and every later reader (Block Revision, Video Review, Production) keep their
 * contract. Pure: no database.
 *
 * Packing rules (each block, in order):
 * - Shots are never split across blocks and stay in script order.
 * - Hard limits of a block of T seconds: at most the rapid-cut shot limit of v1.4 (`shotLimit`,
 *   5 for 15 s, 10 for 30 s), every shot at least one 2 s window (shots x 2 <= T), its distinct
 *   beats ("events") within `max_events_per_block`, its spoken words within the v1.4 ceiling
 *   (speech rate x T minus 30 %, `spokenWordsCeiling`), and at most two scenes, the first of
 *   which must be a whole scene under 8 s (v1.4: only a scene with under ~8 s of content may share
 *   a block, through a hard cut). A single shot always makes a block (it is flagged when it breaks
 *   a limit).
 * - Among the groupings that keep those limits, a dynamic programme picks the one whose blocks
 *   stretch or squeeze the shots least, with small costs for every block, for a break inside a
 *   scene (so breaks fall at scene changes when they can) and for sharing a block between scenes.
 * - Fixed modes: every block is the mode's length. `auto`: 15 s, or 30 s for a block inside one
 *   scene holding at least 4 beats (the owner's "4 to 6 beats that must stay continuous", within
 *   the 30 s event limit) or for a single shot longer than 15 s. `shot` (one generation per shot) cannot be written yet: the caller
 *   refuses it before the pipeline runs, and `breakdown` throws.
 *
 * Timing inside a block: shot durations are scaled by T / (sum of the block's shots) and rounded
 * to whole seconds (largest remainder) so they sum exactly to T, with every shot at least 2 s. A
 * shot longer than the 6 s window maximum is played over consecutive windows of the same shot (v1.4
 * continuation windows: the shot number repeats, no "Cut to"), split as evenly as whole seconds
 * allow, so every window is 2 to 6 s. A shot longer than its block (a 20 s shot in a 15 s block) is
 * clamped to the block, with a warning.
 */
import {
  shotLimit,
  spokenWords,
  spokenWordsCeiling,
  SHOT_WINDOW_MAX_S,
  SHOT_WINDOW_MIN_S,
  type AssetRegistry,
  type BlockMode,
  type FilmDirectorBlockMode,
  type FilmShot,
  type PlanBlock,
  type PlatformConfigInput,
  type ShotPlan,
  type ShotStaging,
  type Staging,
} from "@/server/damis";
import { z } from "zod";

/** A scene with this much content (seconds) or more never shares a block (v1.4's "~8 s"). */
export const SCENE_SHARE_MAX_S = 8;
/** In `auto`, a block inside one scene with at least this many beats may run 30 s. */
export const AUTO_LONG_MIN_BEATS = 4;

const COST_PER_BLOCK = 0.05;
const COST_BREAK_INSIDE_SCENE = 0.15;
const COST_SHARED_SCENES = 0.25;
const COST_BROKEN_LIMIT = 10;

export const breakdownWindowSchema = z.object({
  shot_id: z.string(),
  from_s: z.number(),
  to_s: z.number(),
});
export type BreakdownWindow = z.output<typeof breakdownWindowSchema>;

/** The shots of one block and their windows (seconds from the block's start). */
export const blockShotsSchema = z.object({
  block_id: z.number().int().positive(),
  shot_ids: z.array(z.string()).min(1),
  windows: z.array(breakdownWindowSchema).min(1),
});
export type BlockShots = z.output<typeof blockShotsSchema>;

/** What `direction.breakdown` stores: every block's shots and windows. */
export const storedBreakdownSchema = z.object({ blocks: z.array(blockShotsSchema) });
export type StoredBreakdown = z.output<typeof storedBreakdownSchema>;

export type BreakdownWarning = {
  type: "runtime" | "staging" | "other";
  ref: string;
  message: string;
};

export type BreakdownInput = {
  plan: Pick<ShotPlan, "shots" | "beats" | "scene_geography">;
  blockMode: FilmDirectorBlockMode;
  platform: PlatformConfigInput;
  registry: AssetRegistry;
  /** The script's language (the bible's `script_language`), for the speech rate. */
  language: string | null;
};

export type BreakdownResult = {
  /** v1.4 plan blocks, block_id 1..N. */
  blocks: PlanBlock[];
  /** Per block (same order), its shots and their windows. */
  shotsByBlock: BlockShots[];
  warnings: BreakdownWarning[];
};

/* -------------------------------------------------------------------------- */
/* Packing                                                                     */
/* -------------------------------------------------------------------------- */

type Candidate = { from: number; to: number; length: 15 | 30 };

type Stats = {
  seconds: number;
  words: number;
  beats: number;
  scenes: string[];
};

function statsOf(shots: readonly FilmShot[]): Stats {
  const scenes: string[] = [];
  for (const s of shots) if (!scenes.includes(s.scene_id)) scenes.push(s.scene_id);
  return {
    seconds: shots.reduce((sum, s) => sum + s.duration_s, 0),
    words: spokenWords(shots),
    beats: new Set(shots.flatMap((s) => s.beat_ids)).size,
    scenes,
  };
}

/** The lengths a block may take in this mode. */
function lengthsFor(mode: BlockMode): (15 | 30)[] {
  return mode === "fixed_15" ? [15] : mode === "fixed_30" ? [30] : [15, 30];
}

/** The limits a block of these shots breaks at `length` (empty: none). */
function brokenLimits(
  shots: readonly FilmShot[],
  stats: Stats,
  length: number,
  ctx: {
    platform: PlatformConfigInput;
    language: string | null;
    sceneSeconds: Map<string, number>;
  },
  firstOfScene: boolean,
): string[] {
  const broken: string[] = [];
  const maxShots = shotLimit(length, "rapid_cut");
  if (shots.length > maxShots) broken.push(`${shots.length} shots, at most ${maxShots}`);
  if (shots.length * SHOT_WINDOW_MIN_S > length) {
    broken.push(`${shots.length} shots cannot each have ${SHOT_WINDOW_MIN_S} s`);
  }
  const maxEvents = ctx.platform.max_events_per_block[String(length)];
  if (maxEvents !== undefined && stats.beats > maxEvents) {
    broken.push(`${stats.beats} beats, at most ${maxEvents} events`);
  }
  const ceiling = spokenWordsCeiling(ctx.platform, ctx.language, length);
  if (stats.words > ceiling) broken.push(`${stats.words} spoken words, at most ${ceiling}`);
  if (stats.scenes.length > 2) broken.push(`${stats.scenes.length} scenes, at most 2`);
  if (stats.scenes.length === 2) {
    const first = stats.scenes[0] ?? "";
    if (!firstOfScene || (ctx.sceneSeconds.get(first) ?? Infinity) >= SCENE_SHARE_MAX_S) {
      broken.push(`scene ${first} is not a whole scene under ${SCENE_SHARE_MAX_S} s`);
    }
  }
  return broken;
}

/** The DP over shot positions: the cheapest way to cover shots [0, n) with blocks. */
function pack(shots: readonly FilmShot[], input: BreakdownInput): Candidate[] {
  const mode = input.blockMode;
  if (mode === "shot") {
    throw new Error("The Breakdown cannot write shot-by-shot blocks yet.");
  }
  const sceneSeconds = new Map<string, number>();
  for (const s of shots) {
    sceneSeconds.set(s.scene_id, (sceneSeconds.get(s.scene_id) ?? 0) + s.duration_s);
  }
  const ctx = { platform: input.platform, language: input.language, sceneSeconds };
  const lengths = lengthsFor(mode);
  const maxShots = Math.max(...lengths.map((l) => shotLimit(l, "rapid_cut")));
  const n = shots.length;
  const best: number[] = Array.from({ length: n + 1 }, () => Infinity);
  const choice: (Candidate | null)[] = Array.from({ length: n + 1 }, () => null);
  best[0] = 0;
  for (let from = 0; from < n; from++) {
    const base = best[from] ?? Infinity;
    if (!Number.isFinite(base)) continue;
    const firstOfScene = from === 0 || shots[from - 1]?.scene_id !== shots[from]?.scene_id;
    for (let to = from + 1; to <= Math.min(n, from + maxShots); to++) {
      const group = shots.slice(from, to);
      const stats = statsOf(group);
      for (const length of lengths) {
        if (mode === "auto" && length === 30) {
          const longShot = group.length === 1 && stats.seconds > 15;
          const longMoment = stats.scenes.length === 1 && stats.beats >= AUTO_LONG_MIN_BEATS;
          if (!longShot && !longMoment) continue;
        }
        const broken = brokenLimits(group, stats, length, ctx, firstOfScene);
        // A single shot always makes a block; a group must keep every limit.
        if (broken.length > 0 && group.length > 1) continue;
        const breaksInsideScene = to < n && shots[to - 1]?.scene_id === shots[to]?.scene_id;
        const cost =
          Math.abs(stats.seconds - length) / length +
          COST_PER_BLOCK +
          (breaksInsideScene ? COST_BREAK_INSIDE_SCENE : 0) +
          (stats.scenes.length > 1 ? COST_SHARED_SCENES : 0) +
          broken.length * COST_BROKEN_LIMIT;
        if (base + cost < (best[to] ?? Infinity)) {
          best[to] = base + cost;
          choice[to] = { from, to, length };
        }
      }
    }
  }
  const out: Candidate[] = [];
  for (let at = n; at > 0;) {
    const c = choice[at];
    if (!c) throw new Error("The Breakdown found no grouping of the shots.");
    out.unshift(c);
    at = c.from;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Timing                                                                      */
/* -------------------------------------------------------------------------- */

/** Whole seconds per shot, proportional to `durations`, summing to `total`, each >= `min`. */
export function allotSeconds(durations: readonly number[], total: number, min: number): number[] {
  const sum = durations.reduce((s, d) => s + Math.max(0, d), 0);
  const raw = durations.map((d) =>
    sum > 0 ? (Math.max(0, d) * total) / sum : total / durations.length,
  );
  const out = raw.map((r) => Math.floor(r));
  let left = total - out.reduce((s, d) => s + d, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) {
    const i = order[k]?.i ?? 0;
    out[i] = (out[i] ?? 0) + 1;
  }
  // Raise short shots to the minimum, taking a second at a time from the longest.
  for (;;) {
    const short = out.findIndex((d) => d < min);
    if (short < 0) break;
    let longest = -1;
    out.forEach((d, i) => {
      if (d > min && (longest < 0 || d > (out[longest] ?? 0))) longest = i;
    });
    if (longest < 0) break; // cannot happen when durations.length * min <= total
    out[short] = (out[short] ?? 0) + 1;
    out[longest] = (out[longest] ?? 0) - 1;
  }
  return out;
}

/** A shot's seconds as consecutive windows of 2 to 6 s, as even as whole seconds allow. */
export function splitWindows(seconds: number, max = SHOT_WINDOW_MAX_S): number[] {
  const count = Math.max(1, Math.ceil(seconds / max));
  const base = Math.floor(seconds / count);
  const extra = seconds - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

function windowsFor(shots: readonly FilmShot[], length: number): BreakdownWindow[] {
  const seconds = allotSeconds(
    shots.map((s) => s.duration_s),
    length,
    SHOT_WINDOW_MIN_S,
  );
  const windows: BreakdownWindow[] = [];
  let cursor = 0;
  shots.forEach((shot, i) => {
    for (const part of splitWindows(seconds[i] ?? 0)) {
      windows.push({ shot_id: shot.shot_id, from_s: cursor, to_s: cursor + part });
      cursor += part;
    }
  });
  return windows;
}

/* -------------------------------------------------------------------------- */
/* Plan blocks                                                                 */
/* -------------------------------------------------------------------------- */

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** A film-director staging line in v1.4 terms (no distances: the shot plan gives them in words). */
export function toStaging(s: ShotStaging, onScreen = s.on_screen): Staging {
  return {
    character_id: s.character_id,
    on_screen: onScreen,
    position: `${s.frame_position}, ${s.depth}${s.relation.trim() ? `; ${s.relation.trim()}` : ""}`,
    posture: s.posture,
    facing: s.facing,
    gaze: [s.head.trim(), s.eyeline.trim()].filter(Boolean).join(", "),
    screen_side:
      s.frame_position === "off-screen"
        ? "background"
        : s.frame_position === "centre"
          ? "centre"
          : s.frame_position,
    distances: [],
  };
}

/** Each character's entry in the shot nearest the block's start (or end); off screen until then. */
function stagingAt(
  shots: readonly FilmShot[],
  characters: readonly string[],
  edge: "start" | "end",
): Staging[] {
  const ordered = edge === "start" ? shots : [...shots].reverse();
  const edgeShot = ordered[0];
  return characters.map((id) => {
    const own = edgeShot?.staging.find((s) => s.character_id === id);
    if (own) return toStaging(own);
    for (const shot of ordered) {
      const entry = shot.staging.find((s) => s.character_id === id);
      if (entry) return toStaging(entry, false);
    }
    // Unreachable: a block character is on screen in one of its shots.
    return {
      character_id: id,
      on_screen: false,
      position: "out of frame",
      posture: "",
      facing: "",
      gaze: "",
      screen_side: "background",
      distances: [],
    };
  });
}

/** The scene heading of a scene id (`sc_3` is the registry's third scene), else its location. */
function headingOf(sceneId: string, input: BreakdownInput): string {
  const n = /^sc_(\d+)$/.exec(sceneId);
  const indexed = n ? input.registry.scene_index[Number(n[1]) - 1] : undefined;
  if (indexed?.heading.trim()) return indexed.heading.trim();
  const geo = input.plan.scene_geography.find((g) => g.scene_id === sceneId);
  const location = input.registry.locations.find((l) => l.loc_id === geo?.location_id);
  return location?.name ?? sceneId;
}

function planBlockOf(
  blockId: number,
  shots: readonly FilmShot[],
  length: 15 | 30,
  input: BreakdownInput,
): PlanBlock {
  const first = shots[0];
  const last = shots[shots.length - 1];
  if (!first || !last) throw new Error("a block needs at least one shot");
  const stats = statsOf(shots);
  const characters = unique(
    shots.flatMap((s) => s.staging.filter((st) => st.on_screen).map((st) => st.character_id)),
  );
  const speakers = unique(shots.flatMap((s) => s.dialogue.map((d) => d.speaker_id))).filter(
    (id) => id.trim() !== "",
  );
  const locations = unique(
    stats.scenes.flatMap((id) => {
      const geo = input.plan.scene_geography.find((g) => g.scene_id === id);
      return geo?.location_id ? [geo.location_id] : [];
    }),
  );
  const beatIds = unique(shots.flatMap((s) => s.beat_ids));
  const beats = beatIds
    .map((id) => input.plan.beats.find((b) => b.beat_id === id)?.summary.trim() ?? "")
    .filter(Boolean);
  const maxEvents = input.platform.max_events_per_block[String(length)];
  const rapid = shots.length > shotLimit(length, "standard");
  const cuts = shots
    .map((s) => s.cut_reason.trim())
    .filter(Boolean)
    .join(" ");
  return {
    block_id: blockId,
    version: 1,
    duration_s: length,
    scene_ids: stats.scenes,
    scene_heading: stats.scenes.map((id) => headingOf(id, input)).join(" / "),
    dramatic_function: beats.join(" ") || first.action,
    script_coverage: { start_quote: first.script_quote.start, end_quote: last.script_quote.end },
    start_state: first.start_state,
    end_state: last.end_state,
    start_staging: stagingAt(shots, characters, "start"),
    end_staging: stagingAt(shots, characters, "end"),
    staging_meaning: unique(
      first.staging.filter((s) => s.on_screen && s.relation.trim()).map((s) => s.relation.trim()),
    ).join("; "),
    opening_frame: first.start_state,
    in_progress_at_end: last.end_state,
    continuity: { type: "first", note: "", use_last_frame_as_start: false },
    assets: {
      characters,
      locations,
      props: unique(shots.flatMap((s) => s.props.map((p) => p.prop_id))),
      heard_only: speakers.filter((id) => !characters.includes(id)),
    },
    budgets: {
      spoken_words: stats.words,
      spoken_words_max: spokenWordsCeiling(input.platform, input.language, length),
      events: maxEvents === undefined ? stats.beats : Math.min(stats.beats, maxEvents),
      shot_budget: rapid ? "rapid_cut" : "standard",
    },
    camera_rationale: shots
      .map((s) => `${s.shot_id}: ${s.size}, ${s.camera.angle}, ${s.camera.movement}`)
      .join("; "),
    editing_rationale:
      `${rapid ? `Rapid cutting: ${shots.length} shots in ${length} s, as the shot plan cuts them. ` : ""}${cuts}`.trim() ||
      "Cuts follow the shot plan.",
    applied_rules: [],
  };
}

/**
 * Continuity between consecutive blocks. A block that opens a new scene is `new_scene`; one that
 * goes on in the same scene is a `hard_cut` (blocks always break between two shots, so the next
 * block opens on a new camera set-up, never on the last frame). v1.4 needs a hard cut's
 * start_staging to equal the previous end_staging, so the previous block's end_staging becomes the
 * staging at the cut as the next block's first shot frames it (the next prompt's Staging line).
 * When that would stage a character the previous block only hears, the boundary is kept as a new
 * set-up (`new_scene`) with a warning.
 */
function linkBlocks(blocks: PlanBlock[], warnings: BreakdownWarning[]): void {
  blocks.forEach((block, i) => {
    const previous = i > 0 ? blocks[i - 1] : undefined;
    if (!previous) {
      block.continuity = { type: "first", note: "The film opens.", use_last_frame_as_start: false };
      return;
    }
    const sameScene = previous.scene_ids.at(-1) === block.scene_ids[0];
    if (!sameScene) {
      block.continuity = {
        type: "new_scene",
        note: "A new scene begins.",
        use_last_frame_as_start: false,
      };
      return;
    }
    const clash = block.start_staging.some((s) =>
      previous.assets.heard_only.includes(s.character_id),
    );
    if (clash) {
      warnings.push({
        type: "staging",
        ref: `block ${block.block_id}`,
        message: `Block ${block.block_id} stages a character that block ${previous.block_id} only hears, so the cut between them starts a new set-up.`,
      });
      block.continuity = {
        type: "new_scene",
        note: "The scene goes on from a new set-up.",
        use_last_frame_as_start: false,
      };
      return;
    }
    previous.end_staging = block.start_staging.map((s) => ({
      ...s,
      distances: [...s.distances],
    }));
    block.continuity = {
      type: "hard_cut",
      note: "The scene goes on: a cut to the next shot.",
      use_last_frame_as_start: false,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* The Breakdown                                                               */
/* -------------------------------------------------------------------------- */

export function breakdown(input: BreakdownInput): BreakdownResult {
  const shots = input.plan.shots;
  const warnings: BreakdownWarning[] = [];
  const groups = pack(shots, input);
  const ctx = {
    platform: input.platform,
    language: input.language,
    sceneSeconds: new Map<string, number>(),
  };
  for (const s of shots) {
    ctx.sceneSeconds.set(s.scene_id, (ctx.sceneSeconds.get(s.scene_id) ?? 0) + s.duration_s);
  }
  const blocks: PlanBlock[] = [];
  const shotsByBlock: BlockShots[] = [];
  groups.forEach((group, i) => {
    const blockId = i + 1;
    const members = shots.slice(group.from, group.to);
    const stats = statsOf(members);
    const firstOfScene =
      group.from === 0 || shots[group.from - 1]?.scene_id !== shots[group.from]?.scene_id;
    for (const limit of brokenLimits(members, stats, group.length, ctx, firstOfScene)) {
      warnings.push({
        type: "runtime",
        ref: `block ${blockId}`,
        message: `Block ${blockId} (${members.map((s) => s.shot_id).join(", ")}) is over a limit of a ${group.length} s block: ${limit}.`,
      });
    }
    const single = members[0];
    if (members.length === 1 && single && single.duration_s > group.length) {
      warnings.push({
        type: "runtime",
        ref: single.shot_id,
        message: `Shot ${single.shot_id} runs ${single.duration_s} s; it is clamped to its ${group.length} s block.`,
      });
    } else if (stats.seconds > 0 && group.length / stats.seconds > 2) {
      warnings.push({
        type: "runtime",
        ref: `block ${blockId}`,
        message: `Block ${blockId} stretches ${stats.seconds} s of shots to ${group.length} s.`,
      });
    }
    blocks.push(planBlockOf(blockId, members, group.length, input));
    shotsByBlock.push({
      block_id: blockId,
      shot_ids: members.map((s) => s.shot_id),
      windows: windowsFor(members, group.length),
    });
  });
  linkBlocks(blocks, warnings);
  return { blocks, shotsByBlock, warnings };
}
