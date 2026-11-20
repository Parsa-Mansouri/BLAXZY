import { z } from "zod";
import { creativeBibleShape } from "../creative-dna/schema";
import { assetRegistrySchema, BLOCK_MODES, dialogueSchema } from "../director/schema";
import { DIRECTOR_STYLE_IDS } from "./styles";

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How the Breakdown will group the shots: the Director v1.4 block modes plus `shot` (every shot
 * is its own generation). The film-director only uses it to pace shots and hint block breaks.
 */
export const FILM_DIRECTOR_BLOCK_MODES = [...BLOCK_MODES, "shot"] as const;
export type FilmDirectorBlockMode = (typeof FILM_DIRECTOR_BLOCK_MODES)[number];

export const filmDirectorInputSchema = z.object({
  /** The Director Style Card to direct with (`styles/`). */
  director_id: z.enum(DIRECTOR_STYLE_IDS),
  block_mode: z.enum(FILM_DIRECTOR_BLOCK_MODES),
  /** The bible as a plain shape (a project without one sends the stub, as for the v1.4 Director). */
  creative_bible: creativeBibleShape,
  asset_registry: assetRegistrySchema,
  script: z.string().trim().min(1).max(200_000),
});
export type FilmDirectorInput = z.output<typeof filmDirectorInputSchema>;

/** Mode A: the Director Style Card of one director. */
export const filmDirectorCardInputSchema = z.object({
  director_name: z.string().trim().min(1).max(200),
  /** Films (or a period) to analyse; omitted: the model picks 4 to 6 representative films. */
  films: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
});
export type FilmDirectorCardInput = z.output<typeof filmDirectorCardInputSchema>;

/* -------------------------------------------------------------------------- */
/* Output: the shot plan                                                       */
/* -------------------------------------------------------------------------- */

/*
 * The structured-output rules apply (as in `director/schema.ts`): every key is required (nullable
 * where a value may be absent), no `z.record`, and constraints the SDK would strip (min/max,
 * patterns, uniqueness) are checked by `validate.ts`. Ids are the asset registry's plain ids
 * (`char_1`, `loc_2`, `prop_3`), scene ids are `sc_1`, `sc_2`... and shot ids `s1`, `s2`... in
 * order. `dialogue` reuses the v1.4 Director's dialogue shape (with `heard_as`), so the Breakdown
 * maps shots onto v1.4 plan blocks without translating it.
 */

const text = z.string();

export const FRAME_POSITIONS = ["frame-left", "centre", "frame-right", "off-screen"] as const;
export type FramePosition = (typeof FRAME_POSITIONS)[number];
export const FRAME_DEPTHS = ["foreground", "midground", "background"] as const;
export type FrameDepth = (typeof FRAME_DEPTHS)[number];

/** Step 5, items 2 to 4: one character in (or just out of) one shot. */
export const shotStagingSchema = z.object({
  character_id: text,
  on_screen: z.boolean(),
  frame_position: z.enum(FRAME_POSITIONS),
  depth: z.enum(FRAME_DEPTHS),
  /** Body facing in frame terms ("profile facing frame right", "back to camera"). */
  facing: text,
  head: text,
  /** In frame terms ("toward frame left, at char_2"). */
  eyeline: text,
  /** Ids of the characters this one can see in this shot (empty: sees no one). */
  sees: z.array(text),
  posture: text,
  /** Distance to and side of the other characters ("one step to char_2's right"). */
  relation: text,
});
export type ShotStaging = z.output<typeof shotStagingSchema>;

export const HANDS = ["left", "right", "both"] as const;

/** Step 5, item 5: who holds what, or where it sits. */
export const shotPropSchema = z.object({
  prop_id: text,
  holder_id: z.string().nullable(),
  hand: z.enum(HANDS).nullable(),
  placement: text,
});
export type ShotProp = z.output<typeof shotPropSchema>;

/** Step 5, item 1. */
export const shotCameraSchema = z.object({
  position: text,
  height: text,
  angle: text,
  movement: text,
  background: text,
});
export type ShotCamera = z.output<typeof shotCameraSchema>;

export const filmShotSchema = z.object({
  shot_id: text,
  scene_id: text,
  beat_ids: z.array(text),
  duration_s: z.number(),
  /** Shot size ("wide", "medium close-up", "insert"...). */
  size: text,
  camera: shotCameraSchema,
  staging: z.array(shotStagingSchema),
  props: z.array(shotPropSchema),
  action: text,
  dialogue: z.array(dialogueSchema),
  sound: text,
  cut_reason: text,
  /** The full state at the first frame (Step 6: written out, never "as before"). */
  start_state: text,
  end_state: text,
  /** The first and last words of the script this shot covers, verbatim. */
  script_quote: z.object({ start: text, end: text }),
});
export type FilmShot = z.output<typeof filmShotSchema>;

export const startingPositionSchema = z.object({
  character_id: text,
  position: text,
  facing: text,
});

/** Step 4: one fixed map per scene's location. */
export const sceneGeographySchema = z.object({
  scene_id: text,
  location_id: text,
  /** Absolute layout: where doors, windows, furniture and exits are (compass or room sides). */
  layout: text,
  /** The camera's side of the action (the 180-degree line). */
  camera_side: text,
  /** Who moves or sits on which side of frame. */
  screen_direction: text,
  starting_positions: z.array(startingPositionSchema),
});
export type SceneGeography = z.output<typeof sceneGeographySchema>;

export const beatSchema = z.object({
  beat_id: text,
  scene_id: text,
  summary: text,
  must_survive: z.boolean(),
});
export type Beat = z.output<typeof beatSchema>;

export const directionChangeSchema = z.object({
  script_direction: text,
  directed_version: text,
  reason: text,
});

export const FILM_DIRECTOR_WARNING_TYPES = [
  "input_integrity",
  "missing_asset",
  "style_conflict",
  "runtime",
  "staging",
  "other",
] as const;

export const filmDirectorWarningSchema = z.object({
  type: z.enum(FILM_DIRECTOR_WARNING_TYPES),
  ref: text,
  message: text,
});

export const FILM_DIRECTOR_STATUSES = ["ok", "ok_with_warnings", "blocked"] as const;

/**
 * The film-director's answer (Mode B, steps 1, 2, 4, 5 and 7): the director's notes and changes,
 * one geography per scene, the beats, and the shot plan in script order. A `blocked` answer keeps
 * the shape with empty lists and the reason in `warnings`.
 */
export const shotPlanSchema = z
  .object({
    dami: z.literal("film_director"),
    dami_version: text,
    status: z.enum(FILM_DIRECTOR_STATUSES),
    directors_notes: z.object({ look_intent: text, camera: text, sound: text, rhythm: text }),
    changes: z.array(directionChangeSchema),
    scene_geography: z.array(sceneGeographySchema),
    beats: z.array(beatSchema),
    shots: z.array(filmShotSchema),
    warnings: z.array(filmDirectorWarningSchema),
  })
  .superRefine((out, ctx) => {
    if (out.status === "blocked") {
      if (out.warnings.length === 0) {
        ctx.addIssue({ code: "custom", path: ["warnings"], message: "blocked needs a reason" });
      }
      return;
    }
    if (out.shots.length === 0) {
      ctx.addIssue({ code: "custom", path: ["shots"], message: "at least one shot" });
    }
  });
export type ShotPlan = z.output<typeof shotPlanSchema>;

/** Mode A: the Director Style Card as Markdown, sections 0 to 14. */
export const filmDirectorCardOutputSchema = z.object({ card_markdown: z.string() });
export type FilmDirectorCardOutput = z.output<typeof filmDirectorCardOutputSchema>;
