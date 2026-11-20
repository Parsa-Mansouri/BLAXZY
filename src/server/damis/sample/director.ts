/**
 * Sample DIRECTOR: a deterministic answer built from the input, with no Claude call. It splits the
 * script into scenes and paragraphs ("units"), packs units into blocks within the event and
 * spoken-word budgets, and writes staging, shots and a 180 to 350 word prompt_text that pass the
 * Director's own `check()` for the fixture and for simple screenplay-format scripts (scene
 * headings, action paragraphs, NAME / dialogue paragraphs). All three modes are covered:
 * `write_blocks` re-derives the blocks of the script and writes those of `block_range` on top of
 * the saved plan's staging, ids and bible, as the real mode must.
 */
import type { CreativeBible } from "../creative-dna/schema";
import {
  parseBlockRange,
  directorInputSchema,
  directorPlanInputSchema,
  type AnyDirectorInput,
  type AssetRegistry,
  type Block,
  type BlockShotPlan,
  type ContinuityBible,
  type DirectorOutput,
  type DirectorPlanOutput,
  type PlanBlock,
  type Shot,
  type Staging,
  type VisualLayer,
} from "../director/schema";
import { DIRECTOR_VERSION } from "../director/dami";
import { FORBIDDEN_PROMPT_WORDS, countWords, descriptorFor } from "../director/validate";
import { speechRateWps } from "../shared/platform";
import { cueName } from "./util";
import {
  collapseWhitespace,
  headingPlace,
  headingTime,
  isInterior,
  titleCase,
  truncate,
} from "./util";
import { isSceneHeading, splitLines } from "../shared/script-lines";

/* -------------------------------------------------------------------------- */
/* Script into units                                                           */
/* -------------------------------------------------------------------------- */

type SpokenRun = { text: string; delivery: string };
type Unit = {
  kind: "action" | "dialogue";
  speaker: string | null;
  /** First and last raw lines of the paragraph, for script_coverage quotes. */
  firstQuote: string;
  lastQuote: string;
  /** Action text (action units) or "" . */
  text: string;
  runs: SpokenRun[];
  words: number;
};
type Scene = { id: string; heading: string; real: boolean; units: Unit[] };

function buildUnit(lines: string[], startIndex: number, all: string[]): Unit {
  const trimmed = lines.map((l) => l.trim());
  const speaker = cueName(all, startIndex);
  if (speaker) {
    const runs: SpokenRun[] = [];
    let delivery = "natural, quiet";
    for (const line of trimmed.slice(1)) {
      if (line.startsWith("(") && line.endsWith(")"))
        delivery = line.slice(1, -1).trim() || delivery;
      else runs.push({ text: line, delivery });
    }
    const quote = trimmed.slice(0, 2).join(" ");
    return {
      kind: "dialogue",
      speaker,
      firstQuote: quote,
      lastQuote: trimmed.at(-1) ?? quote,
      text: "",
      runs,
      words: runs.reduce((s, r) => s + countWords(r.text), 0),
    };
  }
  return {
    kind: "action",
    speaker: null,
    firstQuote: trimmed[0] ?? "",
    lastQuote: trimmed.at(-1) ?? "",
    text: collapseWhitespace(trimmed.join(" ")),
    runs: [],
    words: 0,
  };
}

function parseScript(script: string): Scene[] {
  const lines = splitLines(script);
  const scenes: Scene[] = [];
  let current: Scene | null = null;
  const open = (heading: string, real: boolean) => {
    current = { id: `sc_${scenes.length + 1}`, heading, real, units: [] };
    scenes.push(current);
  };
  let i = 0;
  while (i < lines.length) {
    if ((lines[i] ?? "").trim() === "") {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && (lines[i] ?? "").trim() !== "") i++;
    let paragraph = lines.slice(start, i);
    let from = start;
    if (isSceneHeading(paragraph[0] ?? "")) {
      open((paragraph[0] ?? "").trim(), true);
      paragraph = paragraph.slice(1);
      from += 1;
      if (paragraph.length === 0) continue;
    }
    if (
      /^\s*(FADE (IN|OUT)|CUT TO|DISSOLVE TO|SMASH CUT|MATCH CUT|THE END)\b/i.test(
        paragraph[0] ?? "",
      )
    ) {
      continue;
    }
    if (!current) open("Scene 1", false);
    (current as Scene | null)?.units.push(buildUnit(paragraph, from, lines));
  }
  return scenes.filter((s) => s.units.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Removes the words the owner's regex forbids in prompt_text, and the final period. */
export function clean(text: string): string {
  return collapseWhitespace(text.replace(FORBIDDEN_PROMPT_WORDS, " "))
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[.\s]+$/, "");
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  fa: "Persian",
  tr: "Turkish",
  ar: "Arabic",
  es: "Spanish",
  fr: "French",
  de: "German",
};

function languageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase().split(/[-_]/)[0] ?? ""] ?? code;
}

function zoneFor(m: number): Staging["distances"][number]["zone"] {
  return m < 0.5 ? "intimate" : m <= 1.2 ? "personal" : m <= 3.5 ? "social" : "public";
}

const mentions = (text: string, names: readonly (string | undefined)[]) =>
  names.some((n) => {
    const name = (n ?? "").trim();
    if (!name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text);
  });

/* -------------------------------------------------------------------------- */
/* Assets and the continuity bible                                             */
/* -------------------------------------------------------------------------- */

type Cast = { id: string; name: string; descriptor: string; voice: string };
type Place = { id: string; descriptor: string; landmarks: string[] };
type PropAsset = { id: string; name: string; descriptor: string };

const DEFAULT_LANDMARKS = ["the door", "the window", "the table", "the far wall"];

type World = {
  cast: Map<string, Cast>;
  places: Map<string, Place>;
  props: Map<string, PropAsset>;
  sceneCast: Map<string, string[]>;
  scenePlace: Map<string, string>;
  warnings: DirectorOutput["warnings"];
};

function characterDescriptor(c: AssetRegistry["characters"][number]): string {
  const base =
    clean(c.script_description) ||
    clean((c.facts ?? []).map((f) => f.value).join(", ")) ||
    "a person the script does not describe";
  return base;
}

function newWorld(registry: AssetRegistry, scenes: Scene[]): World {
  const world: World = {
    cast: new Map(),
    places: new Map(),
    props: new Map(),
    sceneCast: new Map(),
    scenePlace: new Map(),
    warnings: [],
  };
  let newChars = 0;
  let newLocs = 0;
  for (const scene of scenes) {
    const text = sceneText(scene);
    // Cast of the scene: registry characters named in it, plus unknown speakers.
    const inScene: string[] = [];
    for (const c of registry.characters) {
      if (mentions(text, [c.name, c.name_latin, ...(c.aliases ?? [])])) {
        inScene.push(c.char_id);
        if (!world.cast.has(c.char_id)) {
          world.cast.set(c.char_id, {
            id: c.char_id,
            name: (c.name_latin || c.name).trim(),
            descriptor: characterDescriptor(c),
            // v1.4: only output_21's audible facts, and only for a character who speaks.
            voice: c.speaks
              ? clean(
                  [...(c.voice_delivery ?? []), ...(c.voice_hints ?? []).map((h) => h.value)].join(
                    ", ",
                  ),
                )
              : "",
          });
        }
      }
    }
    for (const unit of scene.units) {
      const speaker = unit.speaker;
      if (!speaker) continue;
      const found = [...world.cast.values()].find(
        (c) => c.name.toLowerCase() === speaker.toLowerCase(),
      );
      if (found) {
        if (!inScene.includes(found.id)) inScene.push(found.id);
        continue;
      }
      newChars += 1;
      const id = `new_char_${newChars}`;
      world.cast.set(id, {
        id,
        name: titleCase(speaker),
        descriptor: `${titleCase(speaker)}, a person whose look the script does not describe`,
        // Not in output_21, so no audible facts to build a voice note from.
        voice: "",
      });
      inScene.push(id);
      world.warnings.push({
        type: "missing_asset",
        ref: id,
        message: `${speaker} speaks in the script but is not in the asset registry; provisional id ${id}.`,
      });
    }
    world.sceneCast.set(scene.id, inScene);
    const place = headingPlace(scene.heading).toLowerCase();
    const indexed = registry.scene_index.find(
      (s) =>
        collapseWhitespace(s.heading).toLowerCase() ===
        collapseWhitespace(scene.heading).toLowerCase(),
    );
    const loc =
      registry.locations.find((l) => l.loc_id === indexed?.location_id) ??
      registry.locations.find((l) =>
        [l.name, l.name_latin, ...(l.aliases ?? [])].some((n) => {
          const name = (n ?? "").trim().toLowerCase();
          return name !== "" && (place.includes(name) || name.includes(place));
        }),
      );
    const placeId = loc?.loc_id ?? `new_loc_${(newLocs += 1)}`;
    world.scenePlace.set(scene.id, placeId);
    if (!world.places.has(placeId)) {
      const landmarks = (loc?.fixed_elements_from_script ?? [])
        .map((e) => clean(e.element))
        .filter(Boolean);
      world.places.set(placeId, {
        id: placeId,
        descriptor:
          (loc ? clean(loc.script_description) : "") ||
          `${titleCase(headingPlace(scene.heading) || "the location")}, ${
            isInterior(scene.heading) ? "an interior" : "an exterior"
          } lit by ${headingTime(scene.heading) ?? "natural"} light`,
        landmarks: (landmarks.length >= 2 ? landmarks : [...landmarks, ...DEFAULT_LANDMARKS]).slice(
          0,
          4,
        ),
      });
      if (!loc) {
        world.warnings.push({
          type: "missing_asset",
          ref: placeId,
          message: `The location of "${scene.heading}" is not in the asset registry; provisional id ${placeId}.`,
        });
      }
    }
    for (const p of registry.props) {
      if (
        mentions(text, [p.name, p.name_latin, ...(p.aliases ?? [])]) &&
        !world.props.has(p.prop_id)
      ) {
        world.props.set(p.prop_id, {
          id: p.prop_id,
          name: p.name,
          descriptor: clean(p.script_description) || p.name,
        });
      }
    }
  }
  return world;
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                      */
/* -------------------------------------------------------------------------- */

type Draft = { scene: Scene; sceneNumber: number; units: Unit[]; firstOfScene: boolean };

function packBlocks(
  scenes: Scene[],
  duration: number,
  maxEvents: number,
  spokenMax: number,
): Draft[] {
  const drafts: Draft[] = [];
  scenes.forEach((scene, s) => {
    let units: Unit[] = [];
    let words = 0;
    let first = true;
    const flush = () => {
      if (units.length === 0) return;
      drafts.push({ scene, sceneNumber: s + 1, units, firstOfScene: first });
      first = false;
      units = [];
      words = 0;
    };
    for (const unit of scene.units) {
      if (units.length > 0 && (units.length >= maxEvents || words + unit.words > spokenMax))
        flush();
      units.push(unit);
      words += unit.words;
    }
    flush();
  });
  void duration;
  return drafts;
}

/**
 * Sizes the blocks toward the project's runtime: a block holds at most `maxEvents` beats, so a
 * script with many short beats would run far past the target. While the plan is more than 10%
 * longer than the target, the two neighbouring action paragraphs with the least text become one
 * beat (the same moment, told in one go). Dialogue is never merged, and what cannot be merged is
 * left long: the runtime warning then says so, no plot is cut or invented.
 */
function fitToTarget(scenes: Scene[], frame: Frame, target: number | null): Scene[] {
  if (!target || target <= 0) return scenes;
  let current = scenes;
  const total = (list: Scene[]) =>
    packBlocks(list, frame.duration, frame.maxEvents, frame.spokenMax).length * frame.duration;
  while (total(current) > target * 1.1) {
    let best: { scene: number; at: number; size: number } | null = null;
    current.forEach((scene, si) => {
      for (let at = 0; at + 1 < scene.units.length; at++) {
        const x = scene.units[at] as Unit;
        const y = scene.units[at + 1] as Unit;
        if (x.kind !== "action" || y.kind !== "action") continue;
        const size = x.text.length + y.text.length;
        if (!best || size < best.size) best = { scene: si, at, size };
      }
    });
    if (!best) break;
    const pick: { scene: number; at: number; size: number } = best;
    current = current.map((scene, si) => {
      if (si !== pick.scene) return scene;
      const x = scene.units[pick.at] as Unit;
      const y = scene.units[pick.at + 1] as Unit;
      const merged: Unit = {
        ...x,
        lastQuote: y.lastQuote,
        text: collapseWhitespace(`${x.text} ${y.text}`),
      };
      return {
        ...scene,
        units: [...scene.units.slice(0, pick.at), merged, ...scene.units.slice(pick.at + 2)],
      };
    });
  }
  return current;
}

const POSTURES = ["standing", "sitting forward", "standing, arms folded", "sitting back"];
const END_POSTURES = [
  "standing, arms loose",
  "sitting upright",
  "standing, one step closer",
  "leaning forward",
];
const GAZES = ["at the other person", "at the floor", "out of frame", "at an object in hand"];
const SIDES: Staging["screen_side"][] = [
  "frame-left",
  "frame-right",
  "centre",
  "foreground",
  "background",
];

function stagingFor(
  cast: Cast[],
  landmarks: string[],
  phase: "start" | "end",
  offset: number,
): Staging[] {
  return cast.map((c, i) => {
    const others = cast.filter((o) => o.id !== c.id);
    const target = others[0]?.name ?? "the room";
    const idx = (i + offset) % POSTURES.length;
    return {
      character_id: c.id,
      on_screen: true,
      position: `by ${landmarks[i % landmarks.length] ?? "the door"}`,
      posture:
        phase === "start" ? (POSTURES[idx] ?? "standing") : (END_POSTURES[idx] ?? "standing"),
      facing: others.length > 0 ? `three-quarter toward ${target}` : "toward the nearest window",
      gaze: phase === "start" ? (GAZES[idx] ?? "at the floor") : `at ${target}`,
      screen_side: SIDES[i % SIDES.length] ?? "centre",
      distances: others.map((o) => {
        const base = 1 + 0.7 * Math.abs(cast.indexOf(o) - i);
        const m = Math.round((phase === "start" ? base : Math.max(0.4, base - 0.3)) * 10) / 10;
        return { to: o.id, zone: zoneFor(m), approx_m: m };
      }),
    };
  });
}

function describeStaging(entries: Staging[], cast: Map<string, Cast>): string {
  if (entries.length === 0) return "No character is in the frame.";
  const parts = entries.map((s) => {
    const name = (cast.get(s.character_id)?.name ?? s.character_id).toUpperCase();
    const nearest = s.distances[0];
    const gap = nearest
      ? `, ${nearest.approx_m} m from ${(cast.get(nearest.to)?.name ?? nearest.to).toUpperCase()}`
      : "";
    return `${name} is ${s.posture} ${s.position}, ${s.screen_side}, facing ${s.facing}, gaze ${s.gaze}${gap}.`;
  });
  return parts.join(" ");
}

function relationship(start: Staging[], end: Staging[]): string {
  const a = start[0]?.distances[0];
  const b = end[0]?.distances[0];
  if (!a || !b) return "The frame holds one person alone with the space around them.";
  return a.zone === b.zone
    ? `The ${a.zone} distance keeps them apart.`
    : `The distance closes from ${a.zone} to ${b.zone}: the relationship thaws.`;
}

type Frame = {
  duration: number;
  aspect: "9:16" | "16:9" | "1:1";
  format: "film" | "series";
  genre: string;
  style: string;
  language: string;
  maxEvents: number;
  spokenMax: number;
};

function frameOf(input: AnyDirectorInput): Frame {
  const bible = input.creative_bible;
  const frame = bible.project_frame;
  const duration = input.block_mode === "fixed_30" ? 30 : input.block_mode === "fixed_15" ? 15 : 15;
  const language = frame.script_language ?? "en";
  // As the validator reads it: a bible without a script language (the stub) uses the default rate.
  const rateLanguage = frame.script_language ?? "";
  const rate =
    input.platform_config.speech_rate_wps[rateLanguage.toLowerCase().split(/[-_]/)[0] ?? ""] ??
    speechRateWps(frame.script_language);
  let spokenMax = Math.floor(rate * duration * 0.7);
  if (frame.max_spoken_words_per_block !== null) {
    spokenMax = Math.min(
      spokenMax,
      Math.floor((frame.max_spoken_words_per_block * duration) / frame.block_length_sec),
    );
  }
  if (frame.dialogue_policy === "none") spokenMax = 0;
  return {
    duration,
    aspect:
      frame.orientation === "landscape" ? "16:9" : frame.orientation === "square" ? "1:1" : "9:16",
    format: frame.format === "series" ? "series" : "film",
    genre: bible.selection.genre_id.replace(/^genre\./, "").replace(/_/g, " "),
    style: bible.selection.style_id.replace(/^style\./, "").replace(/_/g, " "),
    language,
    maxEvents: input.platform_config.max_events_per_block[String(duration)] ?? 2,
    spokenMax,
  };
}

function ruleIds(bible: CreativeBible): { dir: string[]; tb: string[] } {
  return {
    dir: bible.slices.for_director.rules.map((r) => r.id),
    tb: bible.slices.for_text_blocks_video.rules.map((r) => r.id),
  };
}

type Planned = { plan: PlanBlock; draft: Draft };

function planBlocks(
  input: AnyDirectorInput,
  scenes: Scene[],
  world: World,
  frame: Frame,
): Planned[] {
  const drafts = packBlocks(scenes, frame.duration, frame.maxEvents, frame.spokenMax);
  const rules = ruleIds(input.creative_bible);
  const applied = [rules.dir[0], rules.tb[0]].filter((id): id is string => Boolean(id));
  const planned: Planned[] = [];
  drafts.forEach((draft, i) => {
    const text = fullText(draft.units);
    const place = world.places.get(world.scenePlace.get(draft.scene.id) ?? "");
    const sceneCast = (world.sceneCast.get(draft.scene.id) ?? [])
      .map((id) => world.cast.get(id))
      .filter((c): c is Cast => Boolean(c));
    const props = [...world.props.values()].filter((p) => mentions(text, [p.name])).slice(0, 2);
    const previous = planned[i - 1];
    const continuous = previous !== undefined && previous.draft.scene === draft.scene;
    const landmarks = place?.landmarks ?? DEFAULT_LANDMARKS;
    const startStaging =
      continuous && previous
        ? previous.plan.end_staging
        : stagingFor(sceneCast, landmarks, "start", i);
    const endStaging = stagingFor(sceneCast, landmarks, "end", i);
    const words = draft.units.reduce((s, u) => s + u.words, 0);
    const names = sceneCast.map((c) => c.name.toUpperCase());
    const together = names.length > 0 ? names.join(" and ") : "the room";
    const last = endStaging[0];
    const inProgress = last
      ? `${(world.cast.get(last.character_id)?.name ?? "").toUpperCase()} is ${last.posture} ${last.position}, gaze ${last.gaze}, breathing slowly`
      : "The empty room holds its quiet";
    const first = draft.firstOfScene;
    const function_ =
      planned.length === 0
        ? "setup"
        : i === drafts.length - 1
          ? "release"
          : first
            ? "transition"
            : "escalation";
    planned.push({
      draft,
      plan: {
        block_id: i + 1,
        version: 1,
        duration_s: frame.duration,
        scene_ids: [draft.scene.id],
        scene_heading: draft.scene.heading,
        dramatic_function: function_,
        script_coverage: {
          start_quote:
            first && draft.scene.real ? draft.scene.heading : (draft.units[0]?.firstQuote ?? ""),
          end_quote: draft.units.at(-1)?.lastQuote ?? "",
        },
        start_state: `${together} at the start of the moment, positions as staged.`,
        end_state: `${together} at the end of the moment, positions as staged.`,
        start_staging: startStaging,
        end_staging: endStaging,
        staging_meaning: relationship(startStaging, endStaging),
        opening_frame:
          continuous && previous
            ? previous.plan.in_progress_at_end
            : `${together} hold the positions of the scene opening, faces calm, breathing even`,
        in_progress_at_end: inProgress,
        continuity: {
          type: i === 0 ? "first" : continuous ? "continuous" : "new_scene",
          note: continuous
            ? `Same moment, no time gap; ${together} keep their end positions.`
            : `A new scene opens with ${together} in fresh positions.`,
          use_last_frame_as_start: continuous,
        },
        assets: {
          characters: sceneCast.map((c) => c.id),
          locations: place ? [place.id] : [],
          props: props.map((p) => p.id),
          heard_only: [],
        },
        budgets: {
          spoken_words: words,
          spoken_words_max: frame.spokenMax,
          events: draft.units.length,
          shot_budget: "standard",
        },
        camera_rationale: `The camera stays with the owner of the moment at chest height and offsets from the obvious axis (${rules.dir[0] ?? "director rule"}).`,
        editing_rationale: `Few, long shots: the moment is ${function_ === "escalation" ? "building" : "calm"}, and each cut falls at the end of a line or a look.`,
        applied_rules: applied,
      },
    });
  });
  return planned;
}

function sceneText(scene: Scene): string {
  return scene.units.map((u) => (u.kind === "dialogue" ? (u.speaker ?? "") : u.text)).join(" ");
}

function fullText(units: readonly Unit[]): string {
  return units
    .map((u) => (u.kind === "dialogue" ? u.runs.map((r) => r.text).join(" ") : u.text))
    .join(" ");
}

/* -------------------------------------------------------------------------- */
/* Writing a block                                                             */
/* -------------------------------------------------------------------------- */

const SHOT_KINDS = [
  {
    shot: "Wide shot",
    angle: "three-quarter, 30 degrees off the axis",
    height: "chest height",
    camera: "The camera pushes in slowly.",
    avoided: "a centred, symmetrical wide shot from the room's entrance",
    cut: "the cut falls at the end of the opening beat",
  },
  {
    shot: "Medium close-up",
    angle: "three-quarter from frame-right",
    height: "below eye level",
    camera: "The camera holds locked off.",
    avoided: "two faces in strict profile, squared to each other at eye level",
    cut: "the cut falls on a look",
  },
  {
    shot: "Close-up",
    angle: "over the shoulder, 20 degrees off axis",
    height: "eye level",
    camera: "The camera drifts toward the face.",
    avoided: "a dead-centre close-up straight to the lens",
    cut: "the cut falls at the end of a line",
  },
  {
    shot: "Medium shot",
    angle: "low three-quarter from frame-left",
    height: "chest height",
    camera: "The camera tracks half a step.",
    avoided: "a flat medium shot at eye level with both people on one line",
    cut: "the cut falls on a change of posture",
  },
  {
    shot: "Insert",
    angle: "high three-quarter",
    height: "above eye level",
    camera: "The camera holds locked off.",
    avoided: "a straight-down overhead insert",
    cut: "the cut falls on the peak of the action",
  },
] as const;

const REACTIONS = [
  "holds the beat, expression settling",
  "lets out a slow breath, eyes lowering",
  "glances away, then back, jaw loosening",
];
const ATMOSPHERE = [
  "The room is quiet and the light holds an even level across every surface.",
  "Small sounds of the room carry under the scene without drawing attention.",
  "The air feels warm and close, and nothing in the frame moves without a reason.",
];

/** Whole sentences up to about `max` characters (the first one is always kept, cut at a word). */
function firstSentences(text: string, max: number): string {
  const parts = text.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const part of parts) {
    if (out && out.length + part.length + 1 > max) break;
    out = out ? `${out} ${part}` : part;
  }
  const cut = out.length > max ? truncate(out, max).replace(/…$/, "") : out;
  return /[.!?]$/.test(cut) ? cut : `${cut}.`;
}

function speakerOf(unit: Unit, cast: Map<string, Cast>): Cast | undefined {
  return [...cast.values()].find(
    (c) => c.name.toLowerCase() === (unit.speaker ?? "").toLowerCase(),
  );
}

/** The owner's trim order: Look adjectives, Audio detail, action adverbs; descriptors and staging stay. */
const TRIM_STEPS = [
  { actionMax: 200, style: true },
  { actionMax: 110, style: true },
  { actionMax: 110, style: false },
  { actionMax: 60, style: false },
  { actionMax: 35, style: false, brief: true },
] as const;

function writeBlock(
  plan: PlanBlock,
  draft: Draft,
  bible: ContinuityBible,
  frame: Frame,
  castMap: Map<string, Cast>,
): Block {
  let block = composeBlock(plan, draft, bible, frame, castMap, TRIM_STEPS[0]);
  for (const step of TRIM_STEPS.slice(1)) {
    // Aim below the limit: Block Revision adds words when it applies a note.
    if (block.word_count <= 320) break;
    block = composeBlock(plan, draft, bible, frame, castMap, step);
  }
  return block;
}

function composeBlock(
  plan: PlanBlock,
  draft: Draft,
  bible: ContinuityBible,
  frame: Frame,
  castMap: Map<string, Cast>,
  trim: { actionMax: number; style: boolean; brief?: boolean },
): Block {
  const count = plan.duration_s === 30 ? 5 : 3;
  const length = plan.duration_s / count;
  const units = draft.units;
  const chars = plan.assets.characters
    .map((id) => castMap.get(id))
    .filter((c): c is Cast => Boolean(c));
  const shots: Shot[] = [];
  const shotLines: string[] = [];
  const lang = frame.language;
  const spoken = lang.toLowerCase().startsWith("en") ? "" : ` speaking ${languageName(lang)}`;
  for (let s = 0; s < count; s++) {
    const kind = SHOT_KINDS[s % SHOT_KINDS.length] ?? SHOT_KINDS[0];
    const assigned = units.filter(
      (_, u) => Math.min(Math.floor((u * count) / Math.max(units.length, 1)), count - 1) === s,
    );
    const dialogue: Shot["dialogue"] = [];
    const action: string[] = [];
    for (const unit of assigned) {
      if (unit.kind === "dialogue") {
        const who = speakerOf(unit, castMap);
        for (const run of unit.runs) {
          dialogue.push({
            speaker_id: who?.id ?? "",
            line: run.text,
            delivery: run.delivery,
            language: lang,
            heard_as: who && plan.assets.characters.includes(who.id) ? "on_screen" : "off_screen",
          });
          action.push(
            `${(who?.name ?? unit.speaker ?? "").toUpperCase()}${spoken}, ${run.delivery}: "${run.text}"`,
          );
        }
      } else {
        action.push(firstSentences(clean(unit.text), trim.actionMax));
      }
    }
    if (action.length === 0) {
      const c = chars[s % Math.max(chars.length, 1)];
      action.push(
        `${(c?.name ?? "The room").toUpperCase()} ${REACTIONS[s % REACTIONS.length] ?? REACTIONS[0]}.`,
      );
    }
    const window = `${s * length}-${(s + 1) * length}s`;
    const owner =
      (assigned[0] && speakerOf(assigned[0], castMap)?.id) || plan.assets.characters[0] || "";
    const lead = s === 0 ? "" : "Cut to ";
    shots.push({
      window,
      shot_number: s + 1,
      owner,
      shot: kind.shot,
      angle: kind.angle,
      camera_height: kind.height,
      camera: kind.camera,
      action: action.join(" "),
      staging_change: s === count - 1 ? "the characters settle into their end positions" : "",
      default_avoided: kind.avoided,
      default_kept_reason: "",
      cut_reason: s === count - 1 ? "the last beat ends the moment" : kind.cut,
      dialogue,
    });
    shotLines.push(
      `[${window}] ${lead}Shot ${s + 1} — ${kind.shot}, ${kind.angle}${trim.brief ? "" : `, ${kind.height}`}. ${kind.camera} ${action.join(" ")}`,
    );
  }

  const lines: string[] = [
    "BEGIN PROMPT",
    `A ${plan.duration_s}-second sequence from a ${frame.style} ${frame.genre} ${frame.format === "series" ? "series episode" : "film"}, ${frame.aspect}.`,
  ];
  chars.forEach((c, i) => {
    const d = bible.characters.find((b) => b.asset_id === c.id);
    lines.push(
      `${i === 0 ? "Characters: " : ""}@${c.id} ${c.name.toUpperCase()} — ${d?.descriptor ?? c.descriptor}.`,
    );
  });
  for (const id of plan.assets.locations) {
    lines.push(
      `Locations: @${id} — ${bible.locations.find((l) => l.asset_id === id)?.descriptor ?? ""}.`,
    );
  }
  plan.assets.props.forEach((id, i) => {
    lines.push(
      `${i === 0 ? "Props: " : ""}@${id} — ${bible.props.find((p) => p.asset_id === id)?.descriptor ?? ""}.`,
    );
  });
  lines.push(
    `Staging: ${describeStaging(plan.start_staging, castMap)} ${plan.staging_meaning}`,
    `Opening frame: ${plan.opening_frame}.`,
    "Shots:",
    ...shotLines,
  );
  const tail = (extra: string[]) => [
    `Look: Motivated light from the practical sources in the room, natural colour grade.${trim.style ? ` ${bible.style_line}` : ""}`,
    `Audio: ${shots.some((s) => s.dialogue.length > 0) ? "dialogue delivered quietly and clearly, " : ""}soft room ambience, no music.${extra.length > 0 ? ` ${extra.join(" ")}` : ""}`,
    `No subtitles. No text on screen. No extra characters.${chars.length >= 2 ? " No flat side-profile two-shot." : ""}`,
    "END PROMPT",
  ];
  const extra: string[] = [];
  let body = [...lines, ...tail(extra)].join("\n");
  while (countWords(body) < 180 && extra.length < ATMOSPHERE.length * 3) {
    extra.push(ATMOSPHERE[extra.length % ATMOSPHERE.length] ?? "");
    body = [...lines, ...tail(extra)].join("\n");
  }
  return {
    ...plan,
    shots,
    prompt_text: body,
    word_count: countWords(body),
  };
}

/* -------------------------------------------------------------------------- */
/* write_blocks from the craft pipeline's shot plan                            */
/* -------------------------------------------------------------------------- */

/** Prompt trim steps for the shot-plan writer: shorter actions first, then fewer look words. */
const CRAFT_TRIM = [
  { actionMax: 160, look: true },
  { actionMax: 90, look: true },
  { actionMax: 60, look: false },
  { actionMax: 30, look: false },
] as const;

/**
 * A written block that follows the Breakdown exactly: one shot entry per planned window (the
 * first window of a shot cuts to it, later ones repeat its number), the film-director's camera,
 * action and dialogue, and the cinematographer's lens and light in the prompt.
 */
function writeFromShotPlan(
  plan: PlanBlock,
  planned: BlockShotPlan,
  visual: VisualLayer | undefined,
  bible: ContinuityBible,
  frame: Frame,
  castMap: Map<string, Cast>,
): Block {
  let block = composeFromShotPlan(plan, planned, visual, bible, frame, castMap, CRAFT_TRIM[0]);
  for (const step of CRAFT_TRIM.slice(1)) {
    if (block.word_count <= 320) break;
    block = composeFromShotPlan(plan, planned, visual, bible, frame, castMap, step);
  }
  return block;
}

function composeFromShotPlan(
  plan: PlanBlock,
  planned: BlockShotPlan,
  visual: VisualLayer | undefined,
  bible: ContinuityBible,
  frame: Frame,
  castMap: Map<string, Cast>,
  trim: { actionMax: number; look: boolean },
): Block {
  const lit = new Map((visual?.shots ?? []).map((v) => [v.shot_id, v]));
  const nameOf = (id: string) => (castMap.get(id)?.name ?? id).toUpperCase();
  const lang = frame.language;
  const spokenIn = lang.toLowerCase().startsWith("en") ? "" : ` speaking ${languageName(lang)}`;
  const shots: Shot[] = [];
  const shotLines: string[] = [];
  planned.shots.forEach((shot, k) => {
    const look = lit.get(shot.shot_id);
    const owner =
      shot.dialogue.find((d) => plan.assets.characters.includes(d.speaker_id))?.speaker_id ??
      plan.assets.characters[0] ??
      "";
    shot.windows.forEach((w, j) => {
      const window = `${w.from_s}-${w.to_s}s`;
      const first = j === 0;
      const action = first
        ? firstSentences(clean(shot.action) || "The moment plays out", trim.actionMax)
        : firstSentences(clean(shot.end_state) || "The frame holds on the moment", trim.actionMax);
      const spoken = first
        ? shot.dialogue.map(
            (d) =>
              `${d.heard_as === "on_screen" ? nameOf(d.speaker_id) : `The voice of ${nameOf(d.speaker_id)}`}${spokenIn}, ${clean(d.delivery) || "plainly"}: "${d.line}"`,
          )
        : [];
      shots.push({
        window,
        shot_number: k + 1,
        owner,
        shot: shot.size,
        angle: shot.camera.angle,
        camera_height: shot.camera.height,
        camera: shot.camera.movement,
        action,
        staging_change: "",
        default_avoided: "a flat, centred frame at eye level",
        default_kept_reason: "",
        cut_reason: clean(shot.cut_reason) || "the cut follows the shot plan",
        dialogue: first ? shot.dialogue : [],
      });
      const lens = look ? ` ${firstSentences(clean(look.lens), 60)}` : "";
      const lead = first ? (k === 0 ? "" : "Cut to ") : "";
      shotLines.push(
        `[${window}] ${lead}Shot ${k + 1} — ${clean(shot.size)}, ${clean(shot.camera.angle)}, ${clean(shot.camera.height)}.${first ? lens : ""} ${firstSentences(clean(shot.camera.movement) || "The camera holds", 80)} ${action}${spoken.length > 0 ? ` ${spoken.join(" ")}` : ""}`,
      );
    });
  });

  const lines: string[] = [
    "BEGIN PROMPT",
    `A ${plan.duration_s}-second sequence from a ${frame.style} ${frame.genre} ${frame.format === "series" ? "series episode" : "film"}, ${frame.aspect}.`,
  ];
  plan.assets.characters.forEach((id, i) => {
    lines.push(
      `${i === 0 ? "Characters: " : ""}@${id} ${nameOf(id)} — ${descriptorFor(bible, id, plan.block_id) ?? ""}.`,
    );
  });
  for (const id of plan.assets.locations) {
    lines.push(`Locations: @${id} — ${descriptorFor(bible, id, plan.block_id) ?? ""}.`);
  }
  plan.assets.props.forEach((id, i) => {
    lines.push(
      `${i === 0 ? "Props: " : ""}@${id} — ${descriptorFor(bible, id, plan.block_id) ?? ""}.`,
    );
  });
  const firstLook = planned.shots.map((s) => lit.get(s.shot_id)).find(Boolean);
  lines.push(
    `Staging: ${clean(describeStaging(plan.start_staging, castMap))}. ${clean(plan.staging_meaning)}`.trim(),
    `Opening frame: ${firstSentences(clean(plan.opening_frame) || "The scene is under way", 200)}`,
    "Shots:",
    ...shotLines,
  );
  const lookLine = firstLook
    ? `${firstSentences(clean(firstLook.light), 90)} ${trim.look ? firstSentences(clean(firstLook.grade), 70) : ""}`.trim()
    : "Motivated light from the sources in the room, natural colour grade.";
  const hasDialogue = shots.some((s) => s.dialogue.length > 0);
  const tail = (extra: string[]) => [
    `Look: ${lookLine}${trim.look && bible.style_line ? ` ${clean(bible.style_line)}.` : ""}`,
    `Audio: ${hasDialogue ? "dialogue delivered clearly, " : ""}soft room ambience, no music.${extra.length > 0 ? ` ${extra.join(" ")}` : ""}`,
    `No subtitles. No text on screen. No extra characters.${plan.assets.characters.length >= 2 ? " No flat side-profile two-shot." : ""}`,
    "END PROMPT",
  ];
  const extra: string[] = [];
  let body = [...lines, ...tail(extra)].join("\n");
  while (countWords(body) < 180 && extra.length < ATMOSPHERE.length * 4) {
    extra.push(ATMOSPHERE[extra.length % ATMOSPHERE.length] ?? "");
    body = [...lines, ...tail(extra)].join("\n");
  }
  return { ...plan, shots, prompt_text: body, word_count: countWords(body) };
}

/* -------------------------------------------------------------------------- */
/* The three modes                                                             */
/* -------------------------------------------------------------------------- */

type Header = Omit<DirectorPlanOutput, "blocks">;

function blocked(input: AnyDirectorInput): DirectorOutput {
  const empty: ContinuityBible = {
    characters: [],
    locations: [],
    props: [],
    style_line: "",
  };
  return {
    dami: "director",
    dami_version: DIRECTOR_VERSION,
    creative_bible_ref: {
      genre_id: input.creative_bible.selection.genre_id,
      style_id: input.creative_bible.selection.style_id,
      dami_version: input.creative_bible.dami_version,
    },
    status: "blocked",
    project: {
      title: "",
      format: "film",
      episode_number: null,
      aspect_ratio: "9:16",
      block_mode: input.block_mode,
    },
    dramatic_analysis: {
      logline: "",
      dramatic_question: "",
      protagonist_want: "",
      turning_points: [],
      scenes: [],
    },
    directors_notes: {
      look: "",
      camera_personality: "",
      staging_personality: "",
      rhythm_map: "",
      sound_world: "",
      framing_rules: "",
      rules_used: [],
      aesthetic_overrides: [],
    },
    continuity_bible: empty,
    blocks: [],
    totals: {
      block_count: 0,
      count_15: 0,
      count_30: 0,
      total_runtime_s: 0,
      target_runtime_s: 0,
      deviation_pct: 0,
    },
    warnings: [
      {
        type: "input_integrity",
        ref: "creative_bible",
        message: "The Creative Bible is rejected, so nothing can be directed.",
      },
    ],
  };
}

function headerOf(
  input: AnyDirectorInput,
  scenes: Scene[],
  world: World,
  planned: Planned[],
  frame: Frame,
): Header {
  const bible = input.creative_bible;
  const rules = ruleIds(bible);
  const cast = [...world.cast.values()];
  const total = planned.reduce((s, p) => s + p.plan.duration_s, 0);
  const target =
    bible.project_frame.episode_duration_sec ?? bible.project_frame.total_duration_sec ?? total;
  const deviation = target > 0 ? Math.round((Math.abs(total - target) / target) * 1000) / 10 : 0;
  const warnings = [...world.warnings];
  if (deviation > 10) {
    warnings.push({
      type: "runtime",
      ref: "totals",
      message: `Total runtime ${total} s is ${deviation}% from the ${target} s target; no plot was invented to close the gap.`,
    });
  }
  if (bible.validation_status === "needs_user_decision") {
    for (const q of bible.open_questions) {
      warnings.push({
        type: "open_question",
        ref: q.id,
        message: `Open question ${q.id}: provisional default used (${q.provisional_default}).`,
      });
    }
  }
  const dialogue = planned.some((p) => p.draft.units.some((u) => u.kind === "dialogue"));
  if (bible.project_frame.dialogue_policy === "none" && dialogue) {
    warnings.push({
      type: "dialogue_policy",
      ref: "script",
      message: "The dialogue policy is none but the script has dialogue; it is kept.",
    });
  }
  const firstAction =
    scenes[0]?.units.find((u) => u.kind === "action")?.text ?? scenes[0]?.heading ?? "";
  const style = clean(bible.contracts.style_contract).split(/(?<=[.!?])\s+/)[0] ?? "";
  const startFrom = headingPlace(scenes[0]?.heading ?? "");
  const lead = cast[0]?.name ?? "the lead";
  return {
    dami: "director",
    dami_version: DIRECTOR_VERSION,
    creative_bible_ref: {
      genre_id: bible.selection.genre_id,
      style_id: bible.selection.style_id,
      dami_version: bible.dami_version,
    },
    status: warnings.length > 0 ? "ok_with_warnings" : "ok",
    project: {
      title: titleCase(startFrom || "Untitled film"),
      format: frame.format,
      episode_number: null,
      aspect_ratio: frame.aspect,
      block_mode: input.block_mode,
    },
    dramatic_analysis: {
      logline: truncate(firstAction, 160),
      dramatic_question: `Will ${lead} and the others find their way to each other by the end?`,
      protagonist_want: `${lead} wants the moment to be heard.`,
      turning_points: scenes.slice(1).map((s) => `The turn into ${s.heading}.`),
      scenes: scenes.map((scene, i) => ({
        scene_id: scene.id,
        heading: scene.heading,
        dramatic_function: i === 0 ? "setup" : i === scenes.length - 1 ? "release" : "escalation",
        pov_character: cast[0]?.id ?? "",
        emotional_temperature: Math.min(5, 2 + i),
        relationship_start: "Distant and guarded.",
        relationship_end: i === scenes.length - 1 ? "Closer and open." : "Tense but listening.",
      })),
    },
    directors_notes: {
      look: truncate(style, 160),
      camera_personality:
        "Observational: offset angles, few motivated moves, a static frame when the moment needs stillness.",
      staging_personality: "Space carries the relationship: distance closes only when trust does.",
      rhythm_map: "Few, long shots in calm moments; shorter where tension rises.",
      sound_world: "Quiet room ambience, no music unless the script asks for it.",
      framing_rules:
        frame.aspect === "9:16"
          ? "Vertical staging, depth stacking, faces in the upper third."
          : "Lateral blocking that uses the width of the frame.",
      rules_used: rules.dir.slice(0, 3),
      aesthetic_overrides: [],
    },
    continuity_bible: {
      characters: cast
        .filter((c) => planned.some((p) => p.plan.assets.characters.includes(c.id)))
        .map((c) => ({
          asset_id: c.id,
          name: c.name,
          descriptor: c.descriptor,
          voice: c.voice,
          costume_versions: [],
        })),
      locations: [...world.places.values()]
        .filter((l) => planned.some((p) => p.plan.assets.locations.includes(l.id)))
        .map((l) => ({ asset_id: l.id, descriptor: l.descriptor, landmarks: l.landmarks })),
      props: [...world.props.values()]
        .filter((p) => planned.some((b) => b.plan.assets.props.includes(p.id)))
        .map((p) => ({ asset_id: p.id, descriptor: p.descriptor })),
      style_line: truncate(style, 140),
    },
    totals: {
      block_count: planned.length,
      count_15: planned.filter((p) => p.plan.duration_s === 15).length,
      count_30: planned.filter((p) => p.plan.duration_s === 30).length,
      total_runtime_s: total,
      target_runtime_s: target,
      deviation_pct: deviation,
    },
    warnings,
  };
}

/** The sample answer for any mode of the Director. */
export function sampleDirector(raw: unknown): DirectorOutput | DirectorPlanOutput {
  const mode = (raw as { mode?: unknown } | null)?.mode;
  const input: AnyDirectorInput =
    mode === "plan" ? directorPlanInputSchema.parse(raw) : directorInputSchema.parse(raw);
  if (input.creative_bible.validation_status === "rejected") return blocked(input);

  const frame = frameOf(input);
  if (input.mode === "write_blocks" && input.shot_plan) {
    // Craft pipeline: the plan comes from the Breakdown, so the script is not divided again.
    const plan = input.plan;
    const range = input.block_range ? parseBlockRange(input.block_range) : null;
    if (!plan || !range) throw new Error("write_blocks needs a plan and a block_range");
    const castMap = new Map<string, Cast>(
      plan.continuity_bible.characters.map((c) => [
        c.asset_id,
        { id: c.asset_id, name: c.name, descriptor: c.descriptor, voice: c.voice },
      ]),
    );
    const byBlock = new Map(input.shot_plan.map((b) => [b.block_id, b]));
    const { blocks: _planned, ...planHeader } = plan;
    void _planned;
    const written = plan.blocks
      .filter((b) => b.block_id >= range.from && b.block_id <= range.to)
      .map((block) => {
        const shots = byBlock.get(block.block_id);
        if (!shots) throw new Error(`The shot plan has no block ${block.block_id}`);
        return writeFromShotPlan(
          block,
          shots,
          input.visual_layer,
          plan.continuity_bible,
          { ...frame, duration: block.duration_s },
          castMap,
        );
      });
    return { ...planHeader, blocks: written };
  }
  const projectFrame = input.creative_bible.project_frame;
  const scenes = fitToTarget(
    parseScript(input.script),
    frame,
    projectFrame.episode_duration_sec ?? projectFrame.total_duration_sec,
  );
  const world = newWorld(input.asset_registry, scenes);
  const planned = planBlocks(input, scenes, world, frame);
  const header = headerOf(input, scenes, world, planned, frame);

  if (input.mode === "plan") {
    return { ...header, blocks: planned.map((p) => p.plan) };
  }
  if (input.mode === "full") {
    const castMap = world.cast;
    return {
      ...header,
      blocks: planned.map((p) =>
        writeBlock(p.plan, p.draft, header.continuity_bible, frame, castMap),
      ),
    };
  }
  // write_blocks: the saved plan is verbatim; only the shots and prompts are new.
  const plan = input.plan;
  const range = input.block_range ? parseBlockRange(input.block_range) : null;
  if (!plan || !range) throw new Error("write_blocks needs a plan and a block_range");
  const castMap = new Map<string, Cast>(
    plan.continuity_bible.characters.map((c) => [
      c.asset_id,
      { id: c.asset_id, name: c.name, descriptor: c.descriptor, voice: c.voice },
    ]),
  );
  const { blocks: _blocks, ...planHeader } = plan;
  void _blocks;
  const written = plan.blocks
    .filter((b) => b.block_id >= range.from && b.block_id <= range.to)
    .map((block) => {
      const draft = planned.find((p) => p.plan.block_id === block.block_id)?.draft;
      if (!draft) throw new Error(`The script no longer divides into block ${block.block_id}`);
      return writeBlock(block, draft, plan.continuity_bible, frame, castMap);
    });
  return { ...planHeader, blocks: written };
}
