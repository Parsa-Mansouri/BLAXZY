/**
 * DIRECTOR v2.0 (output_22_dir): the owner's `<inputs>` and `<output_format>` as Zod.
 *
 * The structured-output rules of `director/schema.ts` apply: every key is required (nullable where
 * the owner's shape has null), no `z.record`, and constraints the SDK would strip (min/max,
 * patterns) are checked by `validate.ts`. Structured output needs one closed schema per answer
 * shape, so each mode has its own output schema (and its own dami key, see `dami.ts`):
 * - `full`: the whole output_22_dir (`directorV2OutputSchema`);
 * - `plan`: everything except shots and totals (`directorV2PlanOutputSchema`);
 * - `write_shots`: the scenes' shots and new staging states only (`directorV2ShotsOutputSchema`);
 * - `repair`: the owner's repair shape (`directorV2RepairOutputSchema`).
 * A `blocked` answer (the preflight) keeps its mode's full shape with empty lists and the reason
 * in `warnings`, as for v1.4.
 */
import { z } from "zod";
import { creativeBibleShape } from "../creative-dna/schema";
import { assetRegistrySchema, HEARD_AS, stagingSchema } from "../director/schema";
import { DIRECTOR_STYLE_IDS } from "../director-style/styles";
import { breakdownRepairRequestSchema } from "../breakdown/schema";
import {
  DELIVERY_MODES,
  defaultPipelinePlatformConfig,
  pipelinePlatformConfigSchema,
} from "../shared/pipeline-platform";

export { DELIVERY_MODES, type DeliveryMode } from "../shared/pipeline-platform";
export { stagingSchema, type Staging } from "../director/schema";

const text = z.string();

export const DIRECTOR_V2_MODES = ["full", "plan", "write_shots", "repair"] as const;
export type DirectorV2Mode = (typeof DIRECTOR_V2_MODES)[number];

/* -------------------------------------------------------------------------- */
/* Shots                                                                       */
/* -------------------------------------------------------------------------- */

export const SHOT_SIZES = [
  "extreme_wide",
  "wide",
  "full",
  "medium",
  "medium_close",
  "close",
  "extreme_close",
  "ots",
  "pov",
  "insert",
] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];

export const CAMERA_MOVE_INTENTS = [
  "static",
  "push_in",
  "pull_back",
  "pan",
  "tilt",
  "track",
  "follow",
  "arc",
  "crane_up",
  "crane_down",
  "handheld",
  "other",
] as const;
export type CameraMoveIntent = (typeof CAMERA_MOVE_INTENTS)[number];

export const TRANSITIONS = ["cut", "continuous", "scene_change", "time_jump", "end"] as const;
export type Transition = (typeof TRANSITIONS)[number];

/** How good the boundary after a shot is as the start of a new generation (BREAKDOWN reads it). */
export const BREAK_QUALITIES = ["strong", "ok", "weak", "never"] as const;
export type BreakQuality = (typeof BREAK_QUALITIES)[number];

export const TRIM_ANCHORS = ["head", "tail", "center"] as const;
export type TrimAnchor = (typeof TRIM_ANCHORS)[number];

export const dialogueV2Schema = z.object({
  speaker_id: text,
  line: text,
  delivery: text,
  language: text,
  heard_as: z.enum(HEARD_AS),
});
export type DialogueV2 = z.output<typeof dialogueV2Schema>;

/** A shot's duration range in whole seconds; BREAKDOWN picks the final length inside it. */
export const durationRangeSchema = z.object({
  min_s: z.number().int(),
  ideal_s: z.number().int(),
  max_s: z.number().int(),
});
export type DurationRange = z.output<typeof durationRangeSchema>;

export const shotV2Schema = z.object({
  shot_id: text,
  order: z.number().int(),
  scene_id: text,
  location_id: text,
  owner: text,
  size: z.enum(SHOT_SIZES),
  angle: text,
  camera_height: text,
  axis_offset: text,
  camera_move_intent: z.enum(CAMERA_MOVE_INTENTS),
  camera_move_reason: text,
  staging_start_id: text,
  staging_end_id: text,
  staging_change: text,
  /** Present fact at the shot's first second, self-contained (any boundary may open a unit). */
  state_at_start: text,
  action: text,
  /** The action and emotion under way at the shot's last second. */
  in_progress_at_end: text,
  dialogue: z.array(dialogueV2Schema),
  sound_cues: z.array(text),
  assets: z.object({
    characters: z.array(text),
    props: z.array(text),
    heard_only: z.array(text),
  }),
  duration: durationRangeSchema,
  /** What fills the shot when it is stretched toward max_s (wordless directing only). */
  flex_content: text,
  spoken_words: z.number().int(),
  events: z.number().int(),
  rapid_cut: z.boolean(),
  transition_after: z.enum(TRANSITIONS),
  break_quality_after: z.enum(BREAK_QUALITIES),
  trim_anchor: z.enum(TRIM_ANCHORS).nullable(),
  cut_reason: text,
  default_avoided: text,
  default_kept_reason: text,
  applied_rules: z.array(text),
});
export type ShotV2 = z.output<typeof shotV2Schema>;

export const stagingStateSchema = z.object({
  staging_id: text,
  scene_id: text,
  entries: z.array(stagingSchema),
  /** What the space says about the relationship. */
  meaning: text,
});
export type StagingState = z.output<typeof stagingStateSchema>;

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

export const DIRECTOR_V2_WARNING_TYPES = [
  "input_integrity",
  "open_question",
  "missing_asset",
  "runtime",
  "qc",
  "dialogue_policy",
  "staging",
  "delivery_mode",
  "repair_failed",
  "other",
] as const;

export const directorV2WarningSchema = z.object({
  type: z.enum(DIRECTOR_V2_WARNING_TYPES),
  ref: text,
  message: text,
});
export type DirectorV2Warning = z.output<typeof directorV2WarningSchema>;

const STATUSES = ["ok", "ok_with_warnings", "blocked"] as const;

export const directorV2ProjectSchema = z.object({
  title: text,
  format: z.enum(["film", "series"]),
  episode_number: z.number().int().nullable(),
  aspect_ratio: z.enum(["9:16", "16:9", "1:1"]),
  delivery_mode: z.enum(DELIVERY_MODES),
});

export const dramaticAnalysisSchema = z.object({
  logline: text,
  dramatic_question: text,
  protagonist_want: text,
  turning_points: z.array(text),
  scenes: z.array(
    z.object({
      scene_id: text,
      heading: text,
      dramatic_function: text,
      pov_character: text,
      emotional_temperature: z.number().int(),
      relationship_start: text,
      relationship_end: text,
    }),
  ),
});

export const directorsNotesV2Schema = z.object({
  camera_personality: text,
  staging_personality: text,
  rhythm_map: text,
  sound_world: text,
  framing_rules: text,
  rules_used: z.array(text),
  aesthetic_overrides: z.array(z.object({ rule_id: text, scene_id: text, reason: text })),
});
export type DirectorsNotesV2 = z.output<typeof directorsNotesV2Schema>;

export const continuityBibleV2Schema = z.object({
  characters: z.array(
    z.object({
      asset_id: text,
      name: text,
      descriptor: text,
      /** Audible facts from output_21 only; empty if the character never speaks. */
      voice: text,
      /**
       * `from_shot` is the first shot_id wearing the version. A plan has no shots yet: there it is
       * the scene_id where the version starts (see `costumeDescriptorFor`).
       */
      costume_versions: z.array(z.object({ from_shot: text, descriptor: text })),
    }),
  ),
  /** Frozen descriptor with no light words (CINEMATOGRAPHER writes light) and 2–4 landmarks. */
  locations: z.array(z.object({ asset_id: text, descriptor: text, landmarks: z.array(text) })),
  props: z.array(z.object({ asset_id: text, descriptor: text })),
});
export type ContinuityBibleV2 = z.output<typeof continuityBibleV2Schema>;

export const scenePlanEntrySchema = z.object({
  scene_id: text,
  location_id: text,
  time_of_day: text,
  start_staging_id: text,
  end_staging_id: text,
  target_ideal_s: z.number().int(),
  merge_ok_with_next: z.boolean(),
});
export type ScenePlanEntry = z.output<typeof scenePlanEntrySchema>;

export const directorV2TotalsSchema = z.object({
  shot_count: z.number().int(),
  min_runtime_s: z.number(),
  ideal_runtime_s: z.number(),
  max_runtime_s: z.number(),
  target_runtime_s: z.number(),
  deviation_pct: z.number(),
});
export type DirectorV2Totals = z.output<typeof directorV2TotalsSchema>;

const headerShape = {
  dami: z.literal("director"),
  dami_version: text,
  mode: z.enum(DIRECTOR_V2_MODES),
  creative_bible_ref: z.object({ genre_id: text, style_id: text, dami_version: text }),
  status: z.enum(STATUSES),
};

const planShape = {
  ...headerShape,
  project: directorV2ProjectSchema,
  dramatic_analysis: dramaticAnalysisSchema,
  directors_notes: directorsNotesV2Schema,
  continuity_bible: continuityBibleV2Schema,
  scene_plan: z.array(scenePlanEntrySchema),
  staging_states: z.array(stagingStateSchema),
};

function refineBlocked(
  out: { status: string; warnings: unknown[] },
  ctx: z.RefinementCtx,
  list: { path: string; length: number } | null,
): void {
  if (out.status === "blocked") {
    if (out.warnings.length === 0) {
      ctx.addIssue({ code: "custom", path: ["warnings"], message: "blocked needs a reason" });
    }
    return;
  }
  if (list && list.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: [list.path],
      message: `at least one entry in ${list.path}`,
    });
  }
}

/** Mode `full`: the whole output_22_dir. What BREAKDOWN, CINEMATOGRAPHER and PROMPTER read. */
export const directorV2OutputSchema = z
  .object({
    ...planShape,
    shots: z.array(shotV2Schema),
    totals: directorV2TotalsSchema,
    warnings: z.array(directorV2WarningSchema),
  })
  .superRefine((out, ctx) => refineBlocked(out, ctx, { path: "shots", length: out.shots.length }));
export type DirectorV2Output = z.output<typeof directorV2OutputSchema>;

/** Mode `plan`: project, analysis, notes, bible, scene plan and the scenes' start/end staging. */
export const directorV2PlanOutputSchema = z
  .object({ ...planShape, warnings: z.array(directorV2WarningSchema) })
  .superRefine((out, ctx) =>
    refineBlocked(out, ctx, { path: "scene_plan", length: out.scene_plan.length }),
  );
export type DirectorV2PlanOutput = z.output<typeof directorV2PlanOutputSchema>;

/** Mode `write_shots`: the shots of `<scene_range>` and only the staging states they add. */
export const directorV2ShotsOutputSchema = z
  .object({
    ...headerShape,
    shots: z.array(shotV2Schema),
    staging_states: z.array(stagingStateSchema),
    warnings: z.array(directorV2WarningSchema),
  })
  .superRefine((out, ctx) => refineBlocked(out, ctx, { path: "shots", length: out.shots.length }));
export type DirectorV2ShotsOutput = z.output<typeof directorV2ShotsOutputSchema>;

export const sceneRepairSchema = z.object({
  scene_id: text,
  /** The scene's replacement shots, all of them, in order. */
  shots: z.array(shotV2Schema),
  /** New staging states only. */
  staging_states: z.array(stagingStateSchema),
});
export type SceneRepair = z.output<typeof sceneRepairSchema>;

/** Mode `repair`: the owner's repair shape. A request it cannot meet is a `repair_failed` warning. */
export const directorV2RepairOutputSchema = z
  .object({
    dami: z.literal("director"),
    dami_version: text,
    mode: z.enum(DIRECTOR_V2_MODES),
    status: z.enum(STATUSES),
    repairs: z.array(sceneRepairSchema),
    warnings: z.array(directorV2WarningSchema),
  })
  .superRefine((out, ctx) => refineBlocked(out, ctx, null));
export type DirectorV2RepairOutput = z.output<typeof directorV2RepairOutputSchema>;

/** Every answer shape, for the shared prompt, preflight and sample code. */
export type AnyDirectorV2Output =
  DirectorV2Output | DirectorV2PlanOutput | DirectorV2ShotsOutput | DirectorV2RepairOutput;

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

/** `<current_shots>` of repair mode: the scenes' current shots and the staging states they use. */
export const currentShotsSchema = z.object({
  shots: z.array(shotV2Schema).min(1),
  staging_states: z.array(stagingStateSchema),
});
export type CurrentShots = z.output<typeof currentShotsSchema>;

const inputShape = {
  /** The Director Style Card the film is directed with (`director-style/styles/`). */
  director_style_id: z.enum(DIRECTOR_STYLE_IDS),
  delivery_mode: z.enum(DELIVERY_MODES),
  platform_config: pipelinePlatformConfigSchema.default(defaultPipelinePlatformConfig),
  /** The bible as a plain shape: a project without one sends the stub (`director/stub.ts`). */
  creative_bible: creativeBibleShape,
  asset_registry: assetRegistrySchema,
  script: z.string().trim().min(1).max(200_000),
};

/** Input of `director-v2` (mode `full`). */
export const directorV2InputSchema = z.object({ mode: z.literal("full"), ...inputShape });
export type DirectorV2Input = z.output<typeof directorV2InputSchema>;

/** Input of `director-v2-plan` (mode `plan`). */
export const directorV2PlanInputSchema = z.object({ mode: z.literal("plan"), ...inputShape });
export type DirectorV2PlanInput = z.output<typeof directorV2PlanInputSchema>;

/** Input of `director-v2-shots` (mode `write_shots`): the saved plan and a scene range. */
export const directorV2ShotsInputSchema = z.object({
  mode: z.literal("write_shots"),
  ...inputShape,
  plan: directorV2PlanOutputSchema,
  /** `"sc_5-sc_9"` or `"sc_5"`: scene ids of the plan, inclusive, in scene_plan order. */
  scene_range: z.string().trim().min(1),
});
export type DirectorV2ShotsInput = z.output<typeof directorV2ShotsInputSchema>;

/** Input of `director-v2-repair` (mode `repair`): BREAKDOWN's requests for some scenes. */
export const directorV2RepairInputSchema = z.object({
  mode: z.literal("repair"),
  ...inputShape,
  plan: directorV2PlanOutputSchema,
  current_shots: currentShotsSchema,
  repair_requests: z.array(breakdownRepairRequestSchema).min(1),
});
export type DirectorV2RepairInput = z.output<typeof directorV2RepairInputSchema>;

export type AnyDirectorV2Input =
  DirectorV2Input | DirectorV2PlanInput | DirectorV2ShotsInput | DirectorV2RepairInput;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The scene ids of a `scene_range` (`"sc_5-sc_9"`, `"sc_5"`), taken from `sceneIds` (the plan's
 * scene_plan order) from the first to the last inclusive. Null when either end is not a scene of
 * the plan or the range runs backwards.
 */
export function sceneRangeIds(range: string, sceneIds: readonly string[]): string[] | null {
  const [from, to = from] = range.split(/\s*[-–]\s*(?=sc_)/).map((s) => s.trim());
  if (!from || !to) return null;
  const a = sceneIds.indexOf(from);
  const b = sceneIds.indexOf(to);
  if (a < 0 || b < a) return null;
  return sceneIds.slice(a, b + 1);
}

/** The project's target runtime in seconds (an episode's for a series), or null if unknown. */
export function targetRuntimeSeconds(
  frame: z.output<typeof creativeBibleShape>["project_frame"],
): number | null {
  return frame.format === "series"
    ? (frame.episode_duration_sec ?? null)
    : (frame.total_duration_sec ?? frame.episode_duration_sec ?? null);
}

/**
 * The costume descriptor in force for a shot (the latest version starting at or before it), or
 * the character's base descriptor. A version's `from_shot` may be a shot_id or (from a plan) a
 * scene_id, which starts at that scene's first shot. `shots` are in film order.
 */
export function costumeDescriptorFor(
  bible: ContinuityBibleV2,
  characterId: string,
  shotId: string,
  shots: readonly Pick<ShotV2, "shot_id" | "scene_id">[],
): string | null {
  const character = bible.characters.find((c) => c.asset_id === characterId);
  if (!character) return null;
  const position = (ref: string): number => {
    const byShot = shots.findIndex((s) => s.shot_id === ref);
    return byShot >= 0 ? byShot : shots.findIndex((s) => s.scene_id === ref);
  };
  const at = position(shotId);
  let descriptor = character.descriptor;
  let best = -1;
  for (const version of character.costume_versions) {
    const from = position(version.from_shot);
    if (from >= 0 && from <= at && from >= best) {
      best = from;
      descriptor = version.descriptor;
    }
  }
  return descriptor;
}
