/**
 * CINEMATOGRAPHER v1.0 (output_22_dp): the owner's `<inputs>` and `<output_format>` as Zod. One
 * output schema (and one dami key) per mode, because their shapes differ: `look` (the look bible),
 * `shots` (per-shot cinematography and challenges), `relight` (changed light setups). The
 * structured-output rules of `director/schema.ts` apply (every key required, nullable where the
 * owner writes null, word limits checked in `validate.ts`).
 */
import { z } from "zod";
import { creativeBibleShape } from "../creative-dna/schema";
import {
  CAMERA_MOVE_INTENTS,
  continuityBibleV2Schema,
  directorsNotesV2Schema,
  directorV2ProjectSchema,
  scenePlanEntrySchema,
  shotV2Schema,
  stagingStateSchema,
} from "../director-v2/schema";
import {
  defaultPipelinePlatformConfig,
  pipelinePlatformConfigSchema,
} from "../shared/pipeline-platform";
import { CINEMATOGRAPHER_IDS } from "./library";

const text = z.string();

export const CINEMATOGRAPHER_MODES = ["look", "shots", "relight"] as const;
export type CinematographerV1Mode = (typeof CINEMATOGRAPHER_MODES)[number];

export const LENS_FAMILIES = ["wide", "normal", "long", "macro"] as const;
export const DOFS = ["deep", "medium", "shallow"] as const;
export const SUPPORTS = [
  "locked",
  "tripod",
  "dolly",
  "slider",
  "gimbal",
  "handheld",
  "crane",
  "drone",
] as const;
export type Support = (typeof SUPPORTS)[number];
export const MOVE_SPEEDS = ["very_slow", "slow", "medium", "fast"] as const;
export const SHOT_SPEEDS = ["none", ...MOVE_SPEEDS] as const;
export const VOCABULARIES = [
  "photographic",
  "animation_2d",
  "animation_3d",
  "stop_motion",
  "other",
] as const;
const LEVELS = ["low", "medium", "high"] as const;
const STATUSES = ["ok", "ok_with_warnings", "blocked"] as const;

export const CINEMATOGRAPHER_WARNING_TYPES = [
  "input_integrity",
  "look_conflict",
  "guard",
  "missing_setup",
  "other",
] as const;
export const cinematographerWarningSchema = z.object({
  type: z.enum(CINEMATOGRAPHER_WARNING_TYPES),
  ref: text,
  message: text,
});
export type CinematographerWarning = z.output<typeof cinematographerWarningSchema>;

/* -------------------------------------------------------------------------- */
/* The look bible                                                              */
/* -------------------------------------------------------------------------- */

/** One location × time of day; `light_line` is pasted by PROMPTER for every shot in it. */
export const lightSetupSchema = z.object({
  light_id: text,
  location_id: text,
  time_of_day: text,
  key_source: text,
  key_direction: text,
  quality: z.enum(["hard", "soft"]),
  fill: z.enum(LEVELS),
  practicals: z.array(text),
  light_colour: text,
  contrast: z.enum(LEVELS),
  /** What changes the light on screen (a second setup of the same location and time), or "". */
  trigger: text,
  light_line: text,
});
export type LightSetup = z.output<typeof lightSetupSchema>;

export const lensLanguageSchema = z.object({
  use_when: text,
  lens_family: z.enum(LENS_FAMILIES),
  dof: z.enum(DOFS),
  phrase: text,
});
export type LensLanguage = z.output<typeof lensLanguageSchema>;

export const movementLanguageSchema = z.object({
  intent: z.enum(CAMERA_MOVE_INTENTS),
  support: z.enum(SUPPORTS),
  speed: z.enum(MOVE_SPEEDS),
  phrase: text,
});
export type MovementLanguage = z.output<typeof movementLanguageSchema>;

export const lookBibleSchema = z.object({
  vocabulary: z.enum(VOCABULARIES),
  /** One sentence, 15–40 words, pasted into every prompt word for word. */
  look_line: text,
  palette: z.object({
    dominant: z.array(text),
    accents: z.array(z.object({ colour: text, meaning: text })),
    forbidden: z.array(text),
  }),
  light_setups: z.array(lightSetupSchema),
  lens_language: z.array(lensLanguageSchema),
  movement_language: z.array(movementLanguageSchema),
  emotional_temperature_map: z.array(
    z.object({ temperature: z.number().int(), light: text, lens: text }),
  ),
  forbidden_looks: z.array(text),
  portrait_rules: text,
  rules_used: z.array(text),
});
export type LookBible = z.output<typeof lookBibleSchema>;

function refineBlocked(out: { status: string; warnings: unknown[] }, ctx: z.RefinementCtx): void {
  if (out.status === "blocked" && out.warnings.length === 0) {
    ctx.addIssue({ code: "custom", path: ["warnings"], message: "blocked needs a reason" });
  }
}

const header = {
  dami: z.literal("cinematographer"),
  dami_version: text,
  mode: z.enum(CINEMATOGRAPHER_MODES),
  status: z.enum(STATUSES),
};

/** Mode `look`. */
export const lookOutputSchema = z
  .object({
    ...header,
    look_bible: lookBibleSchema,
    warnings: z.array(cinematographerWarningSchema),
  })
  .superRefine(refineBlocked);
export type LookOutput = z.output<typeof lookOutputSchema>;

/* -------------------------------------------------------------------------- */
/* Shots                                                                       */
/* -------------------------------------------------------------------------- */

export const dpShotSchema = z.object({
  shot_id: text,
  light_id: text,
  lighting_change: z
    .object({ to_light_id: text, trigger: text, when: z.enum(["early", "middle", "late"]) })
    .nullable(),
  lens_family: z.enum(LENS_FAMILIES),
  dof: z.enum(DOFS),
  focus_action: text,
  support: z.enum(SUPPORTS),
  speed: z.enum(SHOT_SPEEDS),
  move_path: text,
  frame_start: text,
  frame_end: text,
  composition: z.object({
    subject_position: text,
    headroom: text,
    lead_room: text,
    foreground: text,
    background: text,
  }),
  /** Ready-to-paste English, present tense; PROMPTER pastes them. */
  phrases: z.object({
    lens_phrase: text,
    camera_phrase: text,
    composition_phrase: text,
    light_accent: text,
  }),
  reason: text,
});
export type DpShot = z.output<typeof dpShotSchema>;

export const challengeSchema = z.object({
  shot_id: text,
  field: text,
  director_value: text,
  suggestion: text,
  reason: text,
});
export type Challenge = z.output<typeof challengeSchema>;

/** Mode `shots`. */
export const cinematographerShotsOutputSchema = z
  .object({
    ...header,
    shots: z.array(dpShotSchema),
    challenges: z.array(challengeSchema),
    warnings: z.array(cinematographerWarningSchema),
  })
  .superRefine(refineBlocked);
export type CinematographerShots = z.output<typeof cinematographerShotsOutputSchema>;

/** Mode `relight`: the changed setups of one location and the shots that use them. */
export const relightOutputSchema = z
  .object({
    ...header,
    location_id: text,
    changed_setups: z.array(lightSetupSchema),
    affected_shot_ids: z.array(text),
    warnings: z.array(cinematographerWarningSchema),
  })
  .superRefine(refineBlocked);
export type RelightOutput = z.output<typeof relightOutputSchema>;

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `<director_output>`: output_22_dir (an assembled `DirectorV2Output` parses; other keys are
 * dropped). Shots are all the film's in `look` mode and at least the range's in `shots` mode.
 */
export const directorOutputViewSchema = z.object({
  status: z.enum(STATUSES),
  project: directorV2ProjectSchema,
  directors_notes: directorsNotesV2Schema,
  continuity_bible: continuityBibleV2Schema,
  scene_plan: z.array(scenePlanEntrySchema),
  staging_states: z.array(stagingStateSchema),
  shots: z.array(shotV2Schema),
});
export type DirectorOutputView = z.output<typeof directorOutputViewSchema>;

const inputShape = {
  /** The DP card whose look the film is shot in (`library.ts`). */
  cinematographer_id: z.enum(CINEMATOGRAPHER_IDS),
  platform_config: pipelinePlatformConfigSchema.default(defaultPipelinePlatformConfig),
  creative_bible: creativeBibleShape,
  director_output: directorOutputViewSchema,
};

export const cinematographerLookInputSchema = z.object({ mode: z.literal("look"), ...inputShape });
export type CinematographerLookInput = z.output<typeof cinematographerLookInputSchema>;

export const cinematographerShotsInputSchema = z.object({
  mode: z.literal("shots"),
  ...inputShape,
  look_bible: lookBibleSchema,
  /** `"sc_5-sc_9"` or `"sc_5"`, scene ids of director_output.scene_plan. */
  scene_range: z.string().trim().min(1),
});
export type CinematographerShotsInput = z.output<typeof cinematographerShotsInputSchema>;

/** The approved location sheet (output_30) as text: its visible light, colour and time of day. */
export const locationSheetSchema = z.object({
  location_id: z.string().min(1),
  description: z.string().min(1),
});

export const cinematographerRelightInputSchema = z.object({
  mode: z.literal("relight"),
  ...inputShape,
  look_bible: lookBibleSchema,
  location_sheet: locationSheetSchema,
});
export type CinematographerRelightInput = z.output<typeof cinematographerRelightInputSchema>;

export type AnyCinematographerInput =
  CinematographerLookInput | CinematographerShotsInput | CinematographerRelightInput;
