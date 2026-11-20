/**
 * Sample CINEMATOGRAPHER v1.0: deterministic look bible, shot cinematography and relight answers
 * built from the input, with no Claude call, that pass the damis' own checks. The card's name
 * never appears (only its id is in the input).
 */
import type { ShotV2 } from "../director-v2/schema";
import {
  cinematographerLookInputSchema,
  cinematographerRelightInputSchema,
  cinematographerShotsInputSchema,
  type CinematographerShots,
  type DpShot,
  type LightSetup,
  type LookBible,
  type LookOutput,
  type RelightOutput,
} from "../cinematographer/schema";
import { rangeShots } from "../cinematographer/validate";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "any";

export const sampleLightId = (locationId: string, timeOfDay: string) =>
  `${locationId}_${slug(timeOfDay)}`;

const base = { dami: "cinematographer" as const, dami_version: "1.0" };

function setup(locationId: string, timeOfDay: string): LightSetup {
  return {
    light_id: sampleLightId(locationId, timeOfDay),
    location_id: locationId,
    time_of_day: timeOfDay,
    key_source: "a window out of frame",
    key_direction: "from frame left, three-quarter",
    quality: "soft",
    fill: "low",
    practicals: [],
    light_colour: "neutral, slightly warm",
    contrast: "medium",
    trigger: "",
    light_line:
      "Soft key light from one side of the room, little fill, shadows falling gently toward darkness.",
  };
}

const FORBIDDEN_LOOKS = ["lens flares", "teal-and-orange", "haze", "god rays"];

export function sampleCinematographerLook(raw: unknown): LookOutput {
  const input = cinematographerLookInputSchema.parse(raw);
  const pairs = new Map<string, LightSetup>();
  for (const scene of input.director_output.scene_plan) {
    const s = setup(scene.location_id, scene.time_of_day);
    pairs.set(s.light_id, s);
  }
  const intents = [...new Set(input.director_output.shots.map((s) => s.camera_move_intent))];
  const look_bible: LookBible = {
    vocabulary: "photographic",
    look_line:
      "Photoreal live action, soft natural contrast, restrained earth tones with true skin, fine film texture, calm classical framing.",
    palette: {
      dominant: ["muted earth", "soft grey"],
      accents: [{ colour: "warm skin", meaning: "closeness" }],
      forbidden: ["saturated neon"],
    },
    light_setups: [...pairs.values()],
    lens_language: [
      {
        use_when: "intimate moments",
        lens_family: "long",
        dof: "shallow",
        phrase: "long lens, the background a soft blur",
      },
      {
        use_when: "geography and groups",
        lens_family: "normal",
        dof: "deep",
        phrase: "normal lens, deep even focus",
      },
      {
        use_when: "isolation in space",
        lens_family: "wide",
        dof: "deep",
        phrase: "wide view, the figure small in open space",
      },
    ],
    movement_language: (intents.length > 0 ? intents : ["static" as const]).map((intent) => ({
      intent,
      support:
        intent === "static"
          ? ("locked" as const)
          : intent === "handheld"
            ? ("handheld" as const)
            : ("dolly" as const),
      speed: "slow" as const,
      phrase:
        intent === "static"
          ? "A locked-off camera holds at chest height."
          : "The camera moves slowly and smoothly, close to the subject.",
    })),
    emotional_temperature_map: [1, 2, 3, 4, 5].map((t) => ({
      temperature: t,
      light: t > 3 ? "harder key, deeper shadow" : "soft key, gentle shadow",
      lens: t > 3 ? "tighter, long lens" : "normal lens",
    })),
    forbidden_looks: FORBIDDEN_LOOKS,
    portrait_rules:
      "Stack figures in depth; faces in the upper third; keep the top and bottom edges free of key action.",
    rules_used: input.creative_bible.slices.for_director.rules.slice(0, 1).map((r) => r.id),
  };
  if (
    input.creative_bible.validation_status === "rejected" ||
    input.director_output.status === "blocked"
  ) {
    return {
      ...base,
      mode: "look",
      status: "blocked",
      look_bible: { ...look_bible, light_setups: [] },
      warnings: [{ type: "other", ref: "creative_bible", message: "Blocked upstream." }],
    };
  }
  return { ...base, mode: "look", status: "ok", look_bible, warnings: [] };
}

function shotFor(shot: ShotV2, lightId: string): DpShot {
  const close = ["close", "extreme_close", "medium_close", "insert"].includes(shot.size);
  const intent = shot.camera_move_intent;
  const support =
    intent === "static"
      ? "locked"
      : intent === "handheld"
        ? "handheld"
        : intent === "push_in" || intent === "pull_back" || intent === "track"
          ? "dolly"
          : "gimbal";
  return {
    shot_id: shot.shot_id,
    light_id: lightId,
    lighting_change: null,
    lens_family: close ? "long" : "normal",
    dof: close ? "shallow" : "deep",
    focus_action: "",
    support,
    speed: intent === "static" ? "none" : "slow",
    move_path: intent === "static" ? "" : "a slow move toward the subject",
    frame_start: shot.size,
    frame_end: shot.size,
    composition: {
      subject_position: "left third",
      headroom: "tight",
      lead_room: "toward the gaze",
      foreground: "",
      background: "the room's far wall",
    },
    phrases: {
      lens_phrase: close ? "long lens, the background a soft blur" : "normal lens, deep even focus",
      camera_phrase:
        intent === "static"
          ? "A locked-off camera holds at chest height."
          : "A slow dolly push toward the subject.",
      composition_phrase: "Subject on the left third, space toward the gaze.",
      light_accent: "",
    },
    reason: close ? "the moment is intimate" : "the room's geography reads",
  };
}

export function sampleCinematographerShots(raw: unknown): CinematographerShots {
  const input = cinematographerShotsInputSchema.parse(raw);
  const shots = rangeShots(input) ?? [];
  const timeOf = new Map(input.director_output.scene_plan.map((s) => [s.scene_id, s.time_of_day]));
  const setups = input.look_bible.light_setups;
  return {
    ...base,
    mode: "shots",
    status: "ok",
    shots: shots.map((s) => {
      const time = (timeOf.get(s.scene_id) ?? "").trim().toLowerCase();
      const found =
        setups.find(
          (x) => x.location_id === s.location_id && x.time_of_day.trim().toLowerCase() === time,
        ) ?? setups.find((x) => x.location_id === s.location_id);
      return shotFor(s, found?.light_id ?? sampleLightId(s.location_id, time));
    }),
    challenges: [],
    warnings: [],
  };
}

export function sampleCinematographerRelight(raw: unknown): RelightOutput {
  const input = cinematographerRelightInputSchema.parse(raw);
  const location = input.location_sheet.location_id;
  const changed = input.look_bible.light_setups
    .filter((s) => s.location_id === location)
    .map((s) => ({
      ...s,
      key_source: "the light the approved sheet shows",
      light_line:
        "Light matches the approved location sheet: one soft key from the side, low fill, gentle falloff into shadow.",
    }));
  return {
    ...base,
    mode: "relight",
    status: "ok",
    location_id: location,
    changed_setups: changed,
    affected_shot_ids:
      changed.length > 0
        ? input.director_output.shots
            .filter((s) => s.location_id === location)
            .map((s) => s.shot_id)
        : [],
    warnings: [],
  };
}
