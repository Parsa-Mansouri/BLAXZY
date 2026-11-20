/**
 * DEPRECATED with the provisional film-director dami (deleted when the worker is rewired).
 * Sample FILM DIRECTOR: a deterministic shot plan built from the input, with no Claude call. It
 * splits the script into scenes (by heading) and paragraphs, makes one shot of 3 to 6 seconds per
 * paragraph (action or one character's dialogue), stages the scene's characters left to right and
 * quotes the script verbatim, so the plan passes the film-director's own `check()` for simple
 * screenplay-format scripts.
 */
import type { AssetRegistry, Dialogue } from "../director/schema";
import { FILM_DIRECTOR_VERSION } from "../film-director/dami";
import {
  filmDirectorInputSchema,
  type Beat,
  type FilmShot,
  type SceneGeography,
  type ShotPlan,
  type ShotStaging,
} from "../film-director/schema";
import { isSceneHeading, splitLines } from "../shared/script-lines";
import { collapseWhitespace, cueName, headingPlace, isTransition, truncate } from "./util";

type Paragraph = {
  speaker: string | null;
  /** The paragraph's words as written (cue included), for the quotes. */
  words: string[];
  /** Spoken lines and their delivery (dialogue paragraphs). */
  spoken: { line: string; delivery: string }[];
  text: string;
};
type Scene = { id: string; heading: string | null; paragraphs: Paragraph[] };

function parse(script: string): Scene[] {
  const lines = splitLines(script);
  const scenes: Scene[] = [];
  let current: Scene | null = null;
  const open = (heading: string | null): Scene => {
    const scene: Scene = { id: `sc_${scenes.length + 1}`, heading, paragraphs: [] };
    scenes.push(scene);
    return scene;
  };
  let i = 0;
  while (i < lines.length) {
    if ((lines[i] ?? "").trim() === "") {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && (lines[i] ?? "").trim() !== "") i++;
    let block = lines.slice(start, i).map((l) => l.trim());
    if (isSceneHeading(block[0] ?? "")) {
      current = open(block[0] ?? null);
      block = block.slice(1);
      if (block.length === 0) continue;
    }
    if (isTransition(block[0] ?? "")) continue;
    const scene = current ?? (current = open(null));
    const speaker = cueName(lines, start);
    const spoken: Paragraph["spoken"] = [];
    if (speaker) {
      let delivery = "plain, quiet";
      for (const line of block.slice(1)) {
        if (line.startsWith("(") && line.endsWith(")")) delivery = line.slice(1, -1) || delivery;
        else spoken.push({ line, delivery });
      }
    }
    scene.paragraphs.push({
      speaker,
      words: block.join(" ").split(/\s+/).filter(Boolean),
      spoken,
      text: collapseWhitespace(block.join(" ")),
    });
  }
  return scenes.filter((s) => s.paragraphs.length > 0);
}

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

const SIDES: readonly ShotStaging["frame_position"][] = ["frame-left", "frame-right", "centre"];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function sampleFilmDirector(raw: unknown): ShotPlan {
  const input = filmDirectorInputSchema.parse(raw);
  const registry: AssetRegistry = input.asset_registry;
  const scenes = parse(input.script);
  const warnings: ShotPlan["warnings"] = [];
  const newIds = new Map<string, string>();

  const characterFor = (name: string): string => {
    const found = registry.characters.find((c) =>
      [c.name, c.name_latin, ...(c.aliases ?? [])].some(
        (n) => (n ?? "").trim().toLowerCase() === name.toLowerCase(),
      ),
    );
    if (found) return found.char_id;
    const existing = newIds.get(name.toLowerCase());
    if (existing) return existing;
    const id = `new_char_${newIds.size + 1}`;
    newIds.set(name.toLowerCase(), id);
    warnings.push({
      type: "missing_asset",
      ref: id,
      message: `${name} speaks but is not in the asset registry; provisional id ${id}.`,
    });
    return id;
  };

  const geography: SceneGeography[] = [];
  const beats: Beat[] = [];
  const shots: FilmShot[] = [];
  let newLocations = 0;

  for (const scene of scenes) {
    const sceneText = scene.paragraphs.map((p) => p.text).join(" ");
    const indexed = scene.heading
      ? registry.scene_index.find(
          (s) =>
            collapseWhitespace(s.heading).toLowerCase() ===
            collapseWhitespace(scene.heading ?? "").toLowerCase(),
        )
      : undefined;
    const cast = new Set<string>(
      indexed?.characters_present ??
        registry.characters
          .filter((c) => mentions(sceneText, [c.name, c.name_latin, ...(c.aliases ?? [])]))
          .map((c) => c.char_id),
    );
    for (const p of scene.paragraphs) if (p.speaker) cast.add(characterFor(p.speaker));
    const castIds = [...cast];

    const place = headingPlace(scene.heading ?? "").toLowerCase();
    const location =
      registry.locations.find((l) => l.loc_id === indexed?.location_id) ??
      registry.locations.find((l) =>
        [l.name, l.name_latin, ...(l.aliases ?? [])].some((n) => {
          const name = (n ?? "").trim().toLowerCase();
          return name !== "" && place !== "" && (place.includes(name) || name.includes(place));
        }),
      );
    const locationId = location?.loc_id ?? `new_loc_${(newLocations += 1)}`;
    if (!location) {
      warnings.push({
        type: "missing_asset",
        ref: locationId,
        message: `The location of ${scene.id} is not in the asset registry; provisional id ${locationId}.`,
      });
    }
    const side = (id: string) => SIDES[castIds.indexOf(id) % SIDES.length] ?? "centre";
    geography.push({
      scene_id: scene.id,
      location_id: locationId,
      layout: "The entrance is on the east side, the main window on the north side.",
      camera_side: "The camera stays on the south side of the action.",
      screen_direction: castIds.map((id) => `${id} keeps to ${side(id)}`).join("; ") || "empty",
      starting_positions: castIds.map((id) => ({
        character_id: id,
        position: `${side(id)} of the room`,
        facing: "toward the centre of the room",
      })),
    });

    for (const p of scene.paragraphs) {
      const n = shots.length + 1;
      const beatId = `b${n}`;
      beats.push({
        beat_id: beatId,
        scene_id: scene.id,
        summary: truncate(p.text, 120),
        must_survive: p.speaker !== null,
      });
      const speakerId = p.speaker ? characterFor(p.speaker) : null;
      const spokenWords = p.spoken.reduce((s, d) => s + d.line.split(/\s+/).length, 0);
      const duration = p.speaker
        ? clamp(Math.ceil(spokenWords / 2.5) + 1, 3, 6)
        : clamp(Math.ceil(p.words.length / 3), 3, 6);
      const language =
        registry.characters.find((c) => c.char_id === speakerId)?.dialogue_language ??
        input.creative_bible.project_frame.script_language ??
        "en";
      const dialogue: Dialogue[] = p.spoken.map((d) => ({
        speaker_id: speakerId ?? "",
        line: d.line,
        delivery: d.delivery,
        language,
        heard_as: "on_screen",
      }));
      const staging: ShotStaging[] = castIds.map((id) => ({
        character_id: id,
        on_screen: true,
        frame_position: side(id),
        depth: id === speakerId ? "foreground" : "midground",
        facing:
          side(id) === "frame-left"
            ? "three-quarter toward frame right"
            : "three-quarter toward frame left",
        head: "level",
        eyeline: id === speakerId ? "toward the listener" : "toward the speaker",
        sees: castIds.filter((other) => other !== id),
        posture: "still",
        relation: "about two steps from the others",
      }));
      const props = registry.props
        .filter((prop) => mentions(p.text, [prop.name, prop.name_latin, ...(prop.aliases ?? [])]))
        .map((prop) => ({
          prop_id: prop.prop_id,
          holder_id: null,
          hand: null,
          placement: "in the action, at the centre of the frame",
        }));
      const state = castIds.map((id) => `${id} at ${side(id)}`).join(", ") || "the empty room";
      shots.push({
        shot_id: `s${n}`,
        scene_id: scene.id,
        beat_ids: [beatId],
        duration_s: duration,
        size: p.speaker ? "medium close-up" : n === 1 ? "wide" : "medium",
        camera: {
          position: "south side of the room, looking north",
          height: "eye level",
          angle: "straight on",
          movement: "locked off",
          background: "the north wall of the location",
        },
        staging,
        props,
        action: p.speaker ? `${speakerId} speaks.` : truncate(p.text, 200),
        dialogue,
        sound: p.speaker ? "the line, room tone" : "room tone",
        cut_reason: p.speaker ? "cut on the end of the line" : "cut when the action completes",
        start_state: state,
        end_state: state,
        script_quote: {
          start: p.words.slice(0, 10).join(" "),
          end: p.words.slice(-10).join(" "),
        },
      });
    }
  }

  return {
    dami: "film_director",
    dami_version: FILM_DIRECTOR_VERSION,
    status: warnings.length > 0 ? "ok_with_warnings" : "ok",
    directors_notes: {
      look_intent: "Practical-feeling places and plain, motivated light.",
      camera: "A mounted, steady camera; it moves only with a moving subject.",
      sound: "Room tone and the lines; a low pulse under the turns.",
      rhythm: "Short holds on wides, cuts on the end of each line.",
    },
    changes: [],
    scene_geography: geography,
    beats,
    shots,
    warnings,
  };
}
