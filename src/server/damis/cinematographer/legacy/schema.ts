import { z } from "zod";
import { creativeBibleShape, type CreativeBible } from "../../creative-dna/schema";
import { shotCameraSchema, type FilmShot, type ShotPlan } from "../../film-director/schema";
import { CINEMATOGRAPHER_IDS, CINEMATOGRAPHER_MODE_IDS } from "../library";

/*
 * Structured-output rules as in `director/schema.ts`: every key required, nullable where absent,
 * no records; whether a mode belongs to the chosen card is checked in `validate.ts`.
 */

const text = z.string();
const cinematographerId = z.enum(CINEMATOGRAPHER_IDS);
const modeId = z.enum(CINEMATOGRAPHER_MODE_IDS);

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

/** The part of the Creative Bible a DP reads: the selection, the frame and the contracts. */
export const cinematographerBibleSchema = creativeBibleShape.pick({
  selection: true,
  project_frame: true,
  contracts: true,
});
export type CinematographerBible = z.output<typeof cinematographerBibleSchema>;

export function cinematographerBible(bible: CreativeBible): CinematographerBible {
  return {
    selection: bible.selection,
    project_frame: bible.project_frame,
    contracts: bible.contracts,
  };
}

export const lookSceneInputSchema = z.object({
  scene_id: z.string().min(1),
  /** A label only ("kitchen", "front step"), never a description: the location sheet owns that. */
  location_label: z.string(),
  interior_exterior: z.string().optional(),
  time_of_day: z.string().optional(),
  summary: z.string(),
});
export type LookSceneInput = z.output<typeof lookSceneInputSchema>;

/** The part of a film-director shot the DP reads (no dialogue, no physical descriptions). */
export const sceneShotInputSchema = z.object({
  shot_id: z.string().min(1),
  size: z.string(),
  camera: shotCameraSchema,
  /** Who is where in frame, in one line per character, by asset id. */
  staging: z.string(),
  action: z.string(),
});
export type SceneShotInput = z.output<typeof sceneShotInputSchema>;

/* -------------------------------------------------------------------------- */
/* Output                                                                      */
/* -------------------------------------------------------------------------- */

/** `look` mode: the film's camera and light language from the card, and one mode per scene. */
export const lookSchema = z.object({
  cinematographer_id: cinematographerId,
  lens_and_camera: text,
  framing: text,
  multi_character_framing: text,
  daylight: text,
  night: text,
  interiors_sealed_light: text,
  color_contrast_texture: text,
  scene_modes: z.array(z.object({ scene_id: text, mode_id: modeId, reason: text })),
});
export type Look = z.output<typeof lookSchema>;

/** `scene` mode: the look of every shot of one scene. */
export const sceneVisualSchema = z.object({
  scene_id: text,
  mode_id: modeId,
  shots: z.array(
    z.object({
      shot_id: text,
      lens: text,
      camera_height_angle: text,
      light: text,
      framing: text,
      grade: text,
      texture: text,
    }),
  ),
});
export type SceneVisual = z.output<typeof sceneVisualSchema>;

export const lookInputSchema = z.object({
  mode: z.literal("look"),
  cinematographer_id: cinematographerId,
  creative_bible: cinematographerBibleSchema,
  scenes: z.array(lookSceneInputSchema).min(1),
});
export type LookInput = z.output<typeof lookInputSchema>;

export const sceneInputSchema = z.object({
  mode: z.literal("scene"),
  cinematographer_id: cinematographerId,
  /** The run's `look` answer, verbatim. */
  look: lookSchema,
  scene: z.object({
    scene_id: z.string().min(1),
    location_label: z.string(),
    time_of_day: z.string().optional(),
  }),
  shots: z.array(sceneShotInputSchema).min(1),
});
export type SceneInput = z.output<typeof sceneInputSchema>;

export const cinematographerInputSchema = z.discriminatedUnion("mode", [
  lookInputSchema,
  sceneInputSchema,
]);
export type CinematographerInput = z.output<typeof cinematographerInputSchema>;

/**
 * What the model answers. Structured output takes one closed object schema per dami, so both
 * modes share this wrapper: the input's mode is filled and the other is null (`check()` enforces
 * it), and `finalize` returns the discriminated `CinematographerResult`.
 */
export const cinematographerOutputSchema = z.object({
  mode: z.enum(["look", "scene"]),
  look: lookSchema.nullable(),
  scene: sceneVisualSchema.nullable(),
});
export type CinematographerOutput = z.output<typeof cinematographerOutputSchema>;

export type CinematographerResult =
  { mode: "look"; look: Look } | { mode: "scene"; scene: SceneVisual };

/* -------------------------------------------------------------------------- */
/* From the film-director's plan                                               */
/* -------------------------------------------------------------------------- */

/** One line per character of a shot's staging, by id, for the DP. */
export function stagingSummary(shot: Pick<FilmShot, "staging">): string {
  return shot.staging
    .map((s) =>
      s.on_screen
        ? `${s.character_id}: ${s.frame_position}, ${s.depth}, ${s.facing}, ${s.posture}`
        : `${s.character_id}: off screen`,
    )
    .join("; ");
}

/** The `scene` mode shots of one scene of a shot plan. */
export function sceneShotsFor(plan: Pick<ShotPlan, "shots">, sceneId: string): SceneShotInput[] {
  return plan.shots
    .filter((s) => s.scene_id === sceneId)
    .map((s) => ({
      shot_id: s.shot_id,
      size: s.size,
      camera: s.camera,
      staging: stagingSummary(s),
      action: s.action,
    }));
}
