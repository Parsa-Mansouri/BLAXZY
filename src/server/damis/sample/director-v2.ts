/**
 * Sample DIRECTOR v2.0: a deterministic answer for every mode, built from the input with no Claude
 * call, that passes the dami's own `check()` for screenplay-format scripts. One shot per script
 * paragraph (action, or one character's speech); each scene starts on one staging state and its
 * last shot moves to a second; ranges leave room for BREAKDOWN; texts carry no look words.
 */
import type { AssetRegistry } from "../director/schema";
import { countWords } from "../director/validate";
import {
  directorV2InputSchema,
  directorV2PlanInputSchema,
  directorV2RepairInputSchema,
  directorV2ShotsInputSchema,
  sceneRangeIds,
  targetRuntimeSeconds,
  type AnyDirectorV2Input,
  type DirectorV2Output,
  type DirectorV2PlanOutput,
  type DirectorV2RepairOutput,
  type DirectorV2ShotsOutput,
  type DirectorV2Warning,
  type ScenePlanEntry,
  type ShotV2,
  type StagingState,
} from "../director-v2/schema";
import { computeTotals, LOOK_VOCABULARY, minSecondsForWords } from "../director-v2/validate";
import { maxShotSeconds, wpsFor } from "../shared/pipeline-platform";
import { cueName, isSceneHeading, isTransition, splitLines } from "../shared/script-lines";
import { collapseWhitespace, headingPlace, truncate } from "./util";

type Paragraph = { speaker: string | null; lines: string[]; delivery: string; text: string };
type Scene = { heading: string | null; paragraphs: Paragraph[] };

/** The same reading as `director-v2/script.ts`, keeping action paragraphs too. */
function parse(script: string): Scene[] {
  const lines = splitLines(script);
  const scenes: Scene[] = [];
  let current: Scene | null = null;
  let i = 0;
  while (i < lines.length) {
    if ((lines[i] ?? "").trim() === "") {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && (lines[i] ?? "").trim() !== "") i++;
    let block = lines.slice(start, i).map((l) => l.trim());
    let cueAt = start;
    if (isSceneHeading(block[0] ?? "")) {
      current = { heading: block[0] ?? null, paragraphs: [] };
      scenes.push(current);
      block = block.slice(1);
      cueAt = start + 1;
      if (block.length === 0) continue;
    }
    if (isTransition(block[0] ?? "")) continue;
    if (!current) {
      current = { heading: null, paragraphs: [] };
      scenes.push(current);
    }
    const speaker = cueName(lines, cueAt);
    if (speaker) {
      let delivery = "plain, quiet";
      const spoken: string[] = [];
      for (const line of block.slice(1)) {
        if (line.startsWith("(") && line.endsWith(")")) delivery = line.slice(1, -1) || delivery;
        else spoken.push(line);
      }
      current.paragraphs.push({
        speaker,
        lines: spoken,
        delivery,
        text: collapseWhitespace(block.join(" ")),
      });
    } else {
      current.paragraphs.push({
        speaker: null,
        lines: [],
        delivery: "",
        text: collapseWhitespace(block.join(" ")),
      });
    }
  }
  return scenes.filter((s) => s.paragraphs.length > 0);
}

/** Look words removed (the sample copies script and registry text into director fields). */
const clean = (text: string) => collapseWhitespace(text.replace(LOOK_VOCABULARY, ""));

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function mentions(text: string, names: readonly (string | undefined)[]): boolean {
  return names.some((n) => {
    const name = (n ?? "").trim();
    return (
      name !== "" &&
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "iu").test(text)
    );
  });
}

const SIDES = ["frame-left", "frame-right", "centre"] as const;

type Built = {
  plan: DirectorV2PlanOutput;
  /** Shots by scene id. */
  shots: Map<string, ShotV2[]>;
  warnings: DirectorV2Warning[];
};

function header(input: AnyDirectorV2Input) {
  return {
    dami: "director" as const,
    dami_version: "2.0",
    creative_bible_ref: {
      genre_id: input.creative_bible.selection.genre_id,
      style_id: input.creative_bible.selection.style_id,
      dami_version: input.creative_bible.dami_version,
    },
  };
}

function stagingState(
  id: string,
  sceneId: string,
  cast: readonly string[],
  landmark: string,
  closer: boolean,
): StagingState {
  return {
    staging_id: id,
    scene_id: sceneId,
    entries: cast.map((c, i) => ({
      character_id: c,
      on_screen: true,
      position: `${i === 0 ? "beside" : "two steps from"} ${landmark}`,
      posture: i === 0 ? "standing" : "seated",
      facing: i % 2 === 0 ? "three-quarter toward frame right" : "three-quarter toward frame left",
      gaze: i === 0 ? "at the others" : "at the floor",
      screen_side: SIDES[i % SIDES.length] ?? "centre",
      distances: cast
        .filter((o) => o !== c)
        .map((o) => ({
          to: o,
          zone: closer ? ("personal" as const) : ("social" as const),
          approx_m: closer ? 1 : 2,
        })),
    })),
    meaning: closer
      ? "The space between them has closed."
      : "They keep apart; the distance shows the tension.",
  };
}

/** Plans the film (or reads the given plan) and writes every scene's shots. */
function build(input: AnyDirectorV2Input): Built {
  const registry: AssetRegistry = input.asset_registry;
  const scenes = parse(input.script);
  const warnings: DirectorV2Warning[] = [];
  const wps = wpsFor(input.platform_config, input.creative_bible.project_frame.script_language);
  const limit = maxShotSeconds(input.delivery_mode);
  const newChars = new Map<string, string>();
  const characterFor = (name: string): string => {
    const found = registry.characters.find((c) =>
      [c.name, c.name_latin, ...(c.aliases ?? [])].some(
        (n) => (n ?? "").trim().toLowerCase() === name.toLowerCase(),
      ),
    );
    if (found) return found.char_id;
    const known = newChars.get(name.toLowerCase());
    if (known) return known;
    const id = `new_char_${newChars.size + 1}`;
    newChars.set(name.toLowerCase(), id);
    warnings.push({
      type: "missing_asset",
      ref: id,
      message: `A speaker is not in output_21; provisional id ${id}.`,
    });
    return id;
  };
  const given = "plan" in input ? input.plan : null;

  const scenePlan: ScenePlanEntry[] = [];
  const stagingStates: StagingState[] = [];
  const shotsByScene = new Map<string, ShotV2[]>();
  const analysis: DirectorV2PlanOutput["dramatic_analysis"]["scenes"] = [];
  let newLocations = 0;

  scenes.forEach((scene, k) => {
    const sceneId = `sc_${k + 1}`;
    const text = scene.paragraphs.map((p) => p.text).join(" ");
    const indexed = scene.heading
      ? registry.scene_index.find(
          (s) =>
            collapseWhitespace(s.heading).toLowerCase() ===
            collapseWhitespace(scene.heading ?? "").toLowerCase(),
        )
      : undefined;
    const planned = given?.scene_plan.find((s) => s.scene_id === sceneId);
    let locationId = planned?.location_id;
    if (!locationId) {
      const place = headingPlace(scene.heading ?? "").toLowerCase();
      const location =
        registry.locations.find((l) => l.loc_id === indexed?.location_id) ??
        registry.locations.find((l) =>
          [l.name, l.name_latin, ...(l.aliases ?? [])].some((n) => {
            const name = (n ?? "").trim().toLowerCase();
            return name !== "" && place !== "" && (place.includes(name) || name.includes(place));
          }),
        );
      locationId = location?.loc_id ?? `new_loc_${(newLocations += 1)}`;
      if (!location)
        warnings.push({
          type: "missing_asset",
          ref: locationId,
          message: `The location of ${sceneId} is not in output_21.`,
        });
    }
    const startId = planned?.start_staging_id ?? `st_sc${k + 1}_01`;
    const endId = planned?.end_staging_id ?? `st_sc${k + 1}_02`;
    let cast: string[];
    const plannedStart = given?.staging_states.find((s) => s.staging_id === startId);
    if (plannedStart) {
      cast = plannedStart.entries.map((e) => e.character_id);
    } else {
      const set = new Set<string>(
        indexed?.characters_present ??
          registry.characters
            .filter((c) => mentions(text, [c.name, c.name_latin, ...(c.aliases ?? [])]))
            .map((c) => c.char_id),
      );
      for (const p of scene.paragraphs) if (p.speaker) set.add(characterFor(p.speaker));
      cast = [...set];
      const landmark =
        registry.locations.find((l) => l.loc_id === locationId)?.fixed_elements_from_script?.[0]
          ?.element ?? "the doorway";
      stagingStates.push(
        stagingState(startId, sceneId, cast, landmark, false),
        stagingState(endId, sceneId, cast, landmark, true),
      );
    }
    const shots: ShotV2[] = [];
    scene.paragraphs.forEach((p, i) => {
      const speakerId = p.speaker ? characterFor(p.speaker) : null;
      const onScreen = speakerId === null || cast.includes(speakerId);
      const words = p.lines.reduce((s, l) => s + countWords(l), 0);
      const floor = input.delivery_mode === "shot" ? input.platform_config.unit_min_s : 3;
      const ideal = Math.min(
        limit,
        Math.max(floor, Math.ceil(words / (0.7 * wps)), minSecondsForWords(words, wps)),
      );
      const min = speakerId ? Math.min(ideal, minSecondsForWords(words, wps)) : 2;
      const idealS = speakerId ? ideal : Math.max(4, floor);
      const last = i === scene.paragraphs.length - 1;
      const language =
        registry.characters.find((c) => c.char_id === speakerId)?.dialogue_language ??
        input.creative_bible.project_frame.script_language ??
        "en";
      shots.push({
        shot_id: `sh_${k + 1}_${String(i + 1).padStart(2, "0")}`,
        order: 0,
        scene_id: sceneId,
        location_id: locationId,
        owner: speakerId ?? cast[0] ?? "",
        size: speakerId ? "medium_close" : i === 0 ? "wide" : "medium",
        angle: "slightly below eye level",
        camera_height: "chest height",
        axis_offset: "25 degrees off the room's main axis",
        camera_move_intent: speakerId ? "push_in" : "static",
        camera_move_reason: speakerId
          ? "the line lands; we move closer to the speaker"
          : "observing the room settles us in it",
        staging_start_id: startId,
        staging_end_id: last ? endId : startId,
        staging_change: last ? "They move closer together." : "",
        state_at_start:
          cast.length > 0
            ? `${cast.join(", ")} hold their places in the room, bodies tense, breathing shallow.`
            : "The room is empty and quiet.",
        action: p.speaker
          ? `${p.speaker} speaks, body turned three-quarter toward the others.`
          : clean(truncate(p.text, 200)) || "A pause.",
        in_progress_at_end: last
          ? "They are settling side by side, shoulders softening."
          : "The moment hangs, eyes held on the speaker.",
        dialogue: p.lines.map((line) => ({
          speaker_id: speakerId ?? "",
          line,
          delivery: p.delivery,
          language,
          heard_as: onScreen ? ("on_screen" as const) : ("off_screen" as const),
        })),
        sound_cues: ["a chair creaks"],
        assets: {
          characters: cast,
          props: registry.props
            .filter((prop) =>
              mentions(p.text, [prop.name, prop.name_latin, ...(prop.aliases ?? [])]),
            )
            .map((prop) => prop.prop_id),
          heard_only: speakerId && !onScreen ? [speakerId] : [],
        },
        duration: { min_s: min, ideal_s: idealS, max_s: Math.min(limit, idealS + 3) },
        flex_content: "a held look and a breath before the next beat",
        spoken_words: words,
        events: speakerId ? 0 : 1,
        rapid_cut: false,
        transition_after: last ? (k === scenes.length - 1 ? "end" : "scene_change") : "cut",
        break_quality_after: last ? "strong" : "ok",
        trim_anchor: input.delivery_mode === "shot" ? "center" : null,
        cut_reason: speakerId ? "cut on the end of the line" : "cut when the action completes",
        default_avoided: "both characters in strict profile, centred, at eye level",
        default_kept_reason: "",
        applied_rules: [],
      });
    });
    shotsByScene.set(sceneId, shots);
    scenePlan.push(
      planned ?? {
        scene_id: sceneId,
        location_id: locationId,
        time_of_day: (indexed?.time_of_day ?? "day").toLowerCase(),
        start_staging_id: startId,
        end_staging_id: endId,
        target_ideal_s: shots.reduce((s, x) => s + x.duration.ideal_s, 0),
        merge_ok_with_next: false,
      },
    );
    analysis.push({
      scene_id: sceneId,
      heading: clean(scene.heading ?? sceneId),
      dramatic_function: k === 0 ? "setup" : k === scenes.length - 1 ? "release" : "escalation",
      pov_character: cast[0] ?? "",
      emotional_temperature: 3,
      relationship_start: "apart",
      relationship_end: "closer",
    });
  });

  const target = targetRuntimeSeconds(input.creative_bible.project_frame);
  const ideal = scenePlan.reduce((s, x) => s + x.target_ideal_s, 0);
  if (
    target &&
    (Math.abs(ideal - target) / target) * 100 > input.platform_config.runtime_tolerance_pct
  ) {
    warnings.push({
      type: "runtime",
      ref: "totals",
      message: `The script plays about ${ideal} s against a ${target} s target; no plot was added.`,
    });
  }
  const forDirector = input.creative_bible.slices.for_director.rules;
  const plan: DirectorV2PlanOutput = given ?? {
    ...header(input),
    mode: "plan",
    status: "ok",
    project: {
      title: clean(scenes[0]?.heading ?? "Untitled"),
      format: input.creative_bible.project_frame.format === "series" ? "series" : "film",
      episode_number: input.creative_bible.project_frame.format === "series" ? 1 : null,
      aspect_ratio:
        input.creative_bible.project_frame.orientation === "portrait"
          ? "9:16"
          : input.creative_bible.project_frame.orientation === "square"
            ? "1:1"
            : "16:9",
      delivery_mode: input.delivery_mode,
    },
    dramatic_analysis: {
      logline: "A family finds its way back to each other.",
      dramatic_question: "Will they reconcile?",
      protagonist_want: "to be understood",
      turning_points: ["the apology"],
      scenes: analysis,
    },
    directors_notes: {
      camera_personality: "Patient and close; the camera moves only when a feeling turns.",
      staging_personality: "Distance carries the conflict; closing it carries the turn.",
      rhythm_map: "Long holds early, shorter cuts at the turn, a long final hold.",
      sound_world: "Room ambience, no music.",
      framing_rules: "Depth stacking, faces in the upper third.",
      rules_used: forDirector.slice(0, 1).map((r) => r.id),
      aesthetic_overrides: [],
    },
    continuity_bible: {
      characters: registry.characters.map((c) => ({
        asset_id: c.char_id,
        name: c.name,
        descriptor: clean(c.script_description),
        voice: c.speaks ? `Speaks ${c.dialogue_language ?? "the script language"}.` : "",
        costume_versions: [],
      })),
      locations: registry.locations.map((l) => ({
        asset_id: l.loc_id,
        descriptor: clean(l.script_description),
        landmarks: (l.fixed_elements_from_script ?? []).slice(0, 4).map((e) => e.element),
      })),
      props: registry.props.map((p) => ({
        asset_id: p.prop_id,
        descriptor: clean(p.script_description),
      })),
    },
    scene_plan: scenePlan,
    staging_states: stagingStates,
    warnings: [],
  };
  return { plan, shots: shotsByScene, warnings };
}

function withOrder(shots: ShotV2[], fullIds: boolean): ShotV2[] {
  return shots.map((s, i) => ({
    ...s,
    order: i + 1,
    shot_id: fullIds ? `sh_${String(i + 1).padStart(4, "0")}` : s.shot_id,
  }));
}

function blocked(input: AnyDirectorV2Input) {
  return {
    status: "blocked" as const,
    warnings: [
      { type: "qc" as const, ref: "creative_bible", message: "The Creative Bible is rejected." },
    ],
    ...header(input),
  };
}

export function sampleDirectorV2(raw: unknown): DirectorV2Output {
  const input = directorV2InputSchema.parse(raw);
  const { plan, shots, warnings } = build(input);
  const all = withOrder(
    plan.scene_plan.flatMap((s) => shots.get(s.scene_id) ?? []),
    true,
  );
  const status = warnings.length > 0 ? "ok_with_warnings" : "ok";
  const out: DirectorV2Output = {
    ...plan,
    mode: "full",
    status,
    shots: all,
    totals: computeTotals(all, targetRuntimeSeconds(input.creative_bible.project_frame)),
    warnings,
  };
  if (input.creative_bible.validation_status === "rejected") {
    return {
      ...out,
      ...blocked(input),
      mode: "full",
      shots: [],
      scene_plan: [],
      staging_states: [],
    };
  }
  return out;
}

export function sampleDirectorV2Plan(raw: unknown): DirectorV2PlanOutput {
  const input = directorV2PlanInputSchema.parse(raw);
  const { plan, warnings } = build(input);
  if (input.creative_bible.validation_status === "rejected") {
    return { ...plan, ...blocked(input), mode: "plan", scene_plan: [], staging_states: [] };
  }
  return { ...plan, status: warnings.length > 0 ? "ok_with_warnings" : "ok", warnings };
}

export function sampleDirectorV2Shots(raw: unknown): DirectorV2ShotsOutput {
  const input = directorV2ShotsInputSchema.parse(raw);
  const base = { ...header(input), mode: "write_shots" as const };
  if (input.creative_bible.validation_status === "rejected") {
    return { ...base, ...blocked(input), shots: [], staging_states: [] };
  }
  const { shots } = build(input);
  const range =
    sceneRangeIds(
      input.scene_range,
      input.plan.scene_plan.map((s) => s.scene_id),
    ) ?? [];
  // The plan carries the runtime warning; a batch adds only missing-asset ones.
  const batch = withOrder(
    range.flatMap((id) => shots.get(id) ?? []),
    false,
  );
  return { ...base, status: "ok", shots: batch, staging_states: [], warnings: [] };
}

/**
 * Sample repair: "add" inserts a wordless hold after the scene's first shot (id + "a"); "remove"
 * lowers every shot's min_s by a second where the spoken time allows.
 */
export function sampleDirectorV2Repair(raw: unknown): DirectorV2RepairOutput {
  const input = directorV2RepairInputSchema.parse(raw);
  const base = { dami: "director" as const, dami_version: "2.0", mode: "repair" as const };
  if (input.creative_bible.validation_status === "rejected") {
    return { ...base, ...blocked(input), mode: "repair", repairs: [] };
  }
  const wps = wpsFor(input.platform_config, input.creative_bible.project_frame.script_language);
  const repairs = input.repair_requests.map((request) => {
    const current = input.current_shots.shots.filter((s) => s.scene_id === request.scene_id);
    let shots: ShotV2[];
    if (request.need === "add" && current[0]) {
      const first = current[0];
      const hold: ShotV2 = {
        ...first,
        shot_id: `${first.shot_id}a`,
        staging_start_id: first.staging_end_id,
        staging_end_id: first.staging_end_id,
        staging_change: "",
        size: first.size === "close" ? "medium" : "close",
        camera_move_intent: "static",
        camera_move_reason: "a held reaction gives the moment room",
        action: "A silent reaction: a slow breath, eyes lowering.",
        dialogue: [],
        assets: { ...first.assets, heard_only: [] },
        spoken_words: 0,
        events: 0,
        duration: {
          min_s: 2,
          ideal_s: input.delivery_mode === "shot" ? input.platform_config.unit_min_s : 3,
          max_s: 6,
        },
        transition_after: current.length === 1 ? first.transition_after : "cut",
        break_quality_after: current.length === 1 ? first.break_quality_after : "ok",
      };
      shots = [
        { ...first, transition_after: "cut", break_quality_after: "ok" },
        hold,
        ...current.slice(1),
      ];
    } else {
      shots = current.map((s) => ({
        ...s,
        duration: {
          ...s.duration,
          min_s: Math.max(
            minSecondsForWords(s.spoken_words, wps),
            Math.min(s.duration.min_s, s.duration.ideal_s) - 1,
            1,
          ),
        },
      }));
    }
    return {
      scene_id: request.scene_id,
      shots: shots.map((s, i) => ({ ...s, order: i + 1 })),
      staging_states: [],
    };
  });
  return { ...base, status: "ok", repairs, warnings: [] };
}
