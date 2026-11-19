import { z } from "zod";
import { creativeBibleShape } from "../creative-dna/schema";
import { PLATFORM_CONFIG } from "../shared/platform";

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

export const DIRECTOR_MODES = ["full", "plan", "write_blocks"] as const;
export type DirectorMode = (typeof DIRECTOR_MODES)[number];
export const BLOCK_MODES = ["fixed_15", "fixed_30", "auto"] as const;
export type BlockMode = (typeof BLOCK_MODES)[number];

/** `<platform_config>`: the numbers `PLATFORM_CONFIG` holds, as the prompt receives them. */
export const platformConfigSchema = z.object({
  block_length_options_sec: z.array(z.number().int().positive()).min(1),
  default_block_length_sec: z.number().int().positive(),
  speech_rate_wps: z.record(z.string(), z.number().positive()),
  max_events_per_block: z.record(z.string(), z.number().int().positive()),
});
export type PlatformConfigInput = z.output<typeof platformConfigSchema>;

/** A mutable copy of the platform constants (the schema's type is not readonly). */
export function defaultPlatformConfig(): PlatformConfigInput {
  return {
    block_length_options_sec: [...PLATFORM_CONFIG.block_length_options_sec],
    default_block_length_sec: PLATFORM_CONFIG.default_block_length_sec,
    speech_rate_wps: { ...PLATFORM_CONFIG.speech_rate_wps },
    max_events_per_block: { ...PLATFORM_CONFIG.max_events_per_block },
  };
}

const text = z.string();

/**
 * The part of the Asset Detector's output_21 (v2) the Director reads. Defined here, not imported
 * from the detector: the Director only needs ids, names, the visual facts, who speaks and the
 * scene index, and other keys of output_21 are ignored (stripped). Voices are not assets in v2
 * (no `voices[]`, no `voice_` ids); a character's voice facts are plain fields.
 */
const factSchema = z.object({
  field: text,
  value: text,
  status: z.enum(["stated", "implied"]).optional(),
});

const registryCharacterSchema = z.object({
  char_id: z.string().regex(/^char_[0-9]+$/),
  name: z.string().min(1),
  name_latin: text.optional(),
  aliases: z.array(text).optional(),
  kind: text.optional(),
  role: text.optional(),
  is_minor: text.optional(),
  script_description: text,
  facts: z.array(factSchema).optional(),
  looks: z.array(z.object({ look_id: text, description: text })).optional(),
  speaks: z.boolean(),
  dialogue_language: z.string().nullable().optional(),
  voice_delivery: z.array(text).optional(),
  voice_hints: z.array(factSchema).optional(),
});

const registryLocationSchema = z.object({
  loc_id: z.string().regex(/^loc_[0-9]+$/),
  name: z.string().min(1),
  name_latin: text.optional(),
  aliases: z.array(text).optional(),
  interior_exterior: text.optional(),
  time_of_day: text.optional(),
  script_description: text,
  facts: z.array(factSchema).optional(),
  fixed_elements_from_script: z.array(z.object({ element: text })).optional(),
});

const registryPropSchema = z.object({
  prop_id: z.string().regex(/^prop_[0-9]+$/),
  name: z.string().min(1),
  name_latin: text.optional(),
  aliases: z.array(text).optional(),
  category_hint: text.optional(),
  script_description: text,
  facts: z.array(factSchema).optional(),
});

const registrySceneSchema = z.object({
  scene_number: text,
  heading: text,
  location_id: z.string().nullable().optional(),
  time_of_day: text.optional(),
  characters_present: z.array(text),
  heard_only: z.array(text).optional(),
  speakers: z.array(text).optional(),
  props_present: z.array(text).optional(),
});

export const assetRegistrySchema = z.object({
  characters: z.array(registryCharacterSchema),
  locations: z.array(registryLocationSchema),
  props: z.array(registryPropSchema),
  scene_index: z.array(registrySceneSchema),
});
export type AssetRegistry = z.output<typeof assetRegistrySchema>;

/** Every id of output_21 the Director may use (a `new_` id is provisional and needs none). */
export function registryAssetIds(registry: AssetRegistry): Set<string> {
  return new Set([
    ...registry.characters.map((c) => c.char_id),
    ...registry.locations.map((l) => l.loc_id),
    ...registry.props.map((p) => p.prop_id),
  ]);
}

const BLOCK_RANGE = /^(\d+)-(\d+)$/;

/** `"9-16"` as inclusive numbers, or null when malformed or reversed. */
export function parseBlockRange(range: string): { from: number; to: number } | null {
  const match = BLOCK_RANGE.exec(range.trim());
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  return from >= 1 && to >= from ? { from, to } : null;
}

/* -------------------------------------------------------------------------- */
/* Output (output_22)                                                          */
/* -------------------------------------------------------------------------- */

/*
 * The structured-output rules apply: every key is required (nullable where the owner's shape has
 * null), no `z.record`, and constraints the SDK would strip (min/max, patterns) are checked by
 * `validate.ts` instead. The owner's output has no `required` list of its own, so every key of
 * their example is required here.
 */

export const SCREEN_SIDES = [
  "frame-left",
  "frame-right",
  "centre",
  "foreground",
  "background",
] as const;
export const DISTANCE_ZONES = ["intimate", "personal", "social", "public"] as const;

export const stagingSchema = z.object({
  character_id: text,
  on_screen: z.boolean(),
  position: text,
  posture: text,
  facing: text,
  gaze: text,
  screen_side: z.enum(SCREEN_SIDES),
  distances: z.array(z.object({ to: text, zone: z.enum(DISTANCE_ZONES), approx_m: z.number() })),
});
export type Staging = z.output<typeof stagingSchema>;

/** How a dialogue line is heard (v1.4); only a speaker in frame is `on_screen`. */
export const HEARD_AS = [
  "on_screen",
  "off_screen",
  "voice_over",
  "phone_or_device",
  "singing",
] as const;
export type HeardAs = (typeof HEARD_AS)[number];

export const dialogueSchema = z.object({
  speaker_id: text,
  line: text,
  delivery: text,
  language: text,
  heard_as: z.enum(HEARD_AS),
});
export type Dialogue = z.output<typeof dialogueSchema>;

export const shotSchema = z.object({
  window: text,
  shot_number: z.number().int(),
  owner: text,
  shot: text,
  angle: text,
  camera_height: text,
  camera: text,
  action: text,
  staging_change: text,
  default_avoided: text,
  default_kept_reason: text,
  cut_reason: text,
  dialogue: z.array(dialogueSchema),
});
export type Shot = z.output<typeof shotSchema>;

export const CONTINUITY_TYPES = ["first", "continuous", "hard_cut", "new_scene"] as const;
export const SHOT_BUDGETS = ["standard", "rapid_cut"] as const;

/** Fields of a block in every mode (the plan keeps these; the written block adds three more). */
const planBlockFields = {
  block_id: z.number().int(),
  version: z.number().int(),
  duration_s: z.number().int(),
  scene_ids: z.array(text),
  scene_heading: text,
  dramatic_function: text,
  script_coverage: z.object({ start_quote: text, end_quote: text }),
  start_state: text,
  end_state: text,
  start_staging: z.array(stagingSchema),
  end_staging: z.array(stagingSchema),
  staging_meaning: text,
  opening_frame: text,
  in_progress_at_end: text,
  continuity: z.object({
    type: z.enum(CONTINUITY_TYPES),
    note: text,
    use_last_frame_as_start: z.boolean(),
  }),
  assets: z.object({
    characters: z.array(text),
    locations: z.array(text),
    props: z.array(text),
    /** v1.4: characters heard but not seen in this block (no @token, no Staging entry). */
    heard_only: z.array(text),
  }),
  budgets: z.object({
    spoken_words: z.number().int(),
    spoken_words_max: z.number().int(),
    events: z.number().int(),
    shot_budget: z.enum(SHOT_BUDGETS),
  }),
  camera_rationale: text,
  editing_rationale: text,
};

/** A block of the plan: everything except `shots`, `prompt_text` and `word_count`. */
export const planBlockSchema = z.object({
  ...planBlockFields,
  applied_rules: z.array(text),
});
export type PlanBlock = z.output<typeof planBlockSchema>;

/** A written block. */
export const blockSchema = z.object({
  ...planBlockFields,
  shots: z.array(shotSchema),
  applied_rules: z.array(text),
  prompt_text: text,
  word_count: z.number().int(),
});
export type Block = z.output<typeof blockSchema>;

const WARNING_TYPES = [
  "input_integrity",
  "open_question",
  "missing_asset",
  "runtime",
  "qc",
  "dialogue_policy",
  "staging",
  "other",
] as const;

export const continuityBibleSchema = z.object({
  characters: z.array(
    z.object({
      asset_id: text,
      name: text,
      descriptor: text,
      voice: text,
      costume_versions: z.array(z.object({ from_block: z.number().int(), descriptor: text })),
    }),
  ),
  locations: z.array(z.object({ asset_id: text, descriptor: text, landmarks: z.array(text) })),
  props: z.array(z.object({ asset_id: text, descriptor: text })),
  style_line: text,
});
export type ContinuityBible = z.output<typeof continuityBibleSchema>;

const headerShape = {
  dami: z.literal("director"),
  dami_version: text,
  creative_bible_ref: z.object({ genre_id: text, style_id: text, dami_version: text }),
  status: z.enum(["ok", "ok_with_warnings", "blocked"]),
  project: z.object({
    title: text,
    format: z.enum(["film", "series"]),
    episode_number: z.number().int().nullable(),
    aspect_ratio: z.enum(["9:16", "16:9", "1:1"]),
    block_mode: z.enum(BLOCK_MODES),
  }),
  dramatic_analysis: z.object({
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
  }),
  directors_notes: z.object({
    look: text,
    camera_personality: text,
    staging_personality: text,
    rhythm_map: text,
    sound_world: text,
    framing_rules: text,
    rules_used: z.array(text),
    aesthetic_overrides: z.array(z.object({ rule_id: text, scene_id: text, reason: text })),
  }),
  continuity_bible: continuityBibleSchema,
};

const tailShape = {
  totals: z.object({
    block_count: z.number().int(),
    count_15: z.number().int(),
    count_30: z.number().int(),
    total_runtime_s: z.number(),
    target_runtime_s: z.number(),
    deviation_pct: z.number(),
  }),
  warnings: z.array(z.object({ type: z.enum(WARNING_TYPES), ref: text, message: text })),
};

/**
 * A `blocked` answer (the owner's preflight for a rejected Creative Bible) is the owner's
 * three-key skeleton. Structured output cannot offer it as an alternative to the full shape, so
 * the model answers with the full shape, `status: "blocked"`, empty lists and the reason in
 * `warnings`; `isBlocked` and the refinements below treat both the same.
 */
export const blockedSkeletonSchema = z.object({
  dami: z.literal("director"),
  status: z.literal("blocked"),
  warnings: z.array(z.object({ type: z.enum(WARNING_TYPES), ref: text, message: text })).min(1),
});

function refineBlocks(
  out: { status: string; blocks: { block_id: number }[]; warnings: unknown[] },
  ctx: z.RefinementCtx,
  needShots: boolean,
): void {
  if (out.status === "blocked") {
    if (out.warnings.length === 0) {
      ctx.addIssue({ code: "custom", path: ["warnings"], message: "blocked needs a reason" });
    }
    return;
  }
  if (out.blocks.length === 0) {
    ctx.addIssue({ code: "custom", path: ["blocks"], message: "at least one block" });
  }
  if (needShots) {
    (out.blocks as Block[]).forEach((block, i) => {
      if (block.shots.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", i, "shots"],
          message: "at least one shot",
        });
      }
    });
  }
}

/** The answer of `full` and `write_blocks`: the blocks are written out. */
export const directorOutputSchema = z
  .object({ ...headerShape, blocks: z.array(blockSchema), ...tailShape })
  .superRefine((out, ctx) => refineBlocks(out, ctx, true));
export type DirectorOutput = z.output<typeof directorOutputSchema>;

/** The answer of `plan`: the same, with plan blocks (no shots, prompt_text, word_count). */
export const directorPlanOutputSchema = z
  .object({ ...headerShape, blocks: z.array(planBlockSchema), ...tailShape })
  .superRefine((out, ctx) => refineBlocks(out, ctx, false));
export type DirectorPlanOutput = z.output<typeof directorPlanOutputSchema>;

export function isBlocked(output: { status: string }): boolean {
  return output.status === "blocked";
}

/* -------------------------------------------------------------------------- */
/* Stored rows (read back from jsonb)                                          */
/* -------------------------------------------------------------------------- */

/*
 * The schemas above are what the model must answer (strict, every key required). Rows written by
 * an older Director (owner v1.3) are read back with the `stored*` schemas below: they upgrade the
 * raw JSON to the current shape first, then parse it with the strict schema, so every reader gets
 * the current type. v1.3 differences: block `assets.voices` (voice_ ids, dropped) instead of
 * `assets.heard_only` (becomes []), no `heard_as` on dialogue (on_screen for a speaker listed in
 * the block's characters, off_screen otherwise), and a bible `voices[]` (dropped: z.object strips
 * unknown keys).
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored block (written or planned) in the current shape; anything else is left as it is. */
export function upgradeStoredBlock(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const block: Record<string, unknown> = { ...raw };
  const characters: unknown[] = [];
  if (isRecord(raw.assets)) {
    const assets: Record<string, unknown> = { ...raw.assets };
    delete assets.voices;
    if (Array.isArray(assets.characters)) characters.push(...assets.characters);
    block.assets = { ...assets, heard_only: assets.heard_only ?? [] };
  }
  if (Array.isArray(raw.shots)) {
    block.shots = raw.shots.map((shot) => {
      if (!isRecord(shot) || !Array.isArray(shot.dialogue)) return shot;
      return {
        ...shot,
        dialogue: shot.dialogue.map((d) =>
          isRecord(d) && d.heard_as === undefined
            ? { ...d, heard_as: characters.includes(d.speaker_id) ? "on_screen" : "off_screen" }
            : d,
        ),
      };
    });
  }
  return block;
}

/** A stored answer (header + blocks), with every block upgraded. */
function upgradeStoredOutput(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.blocks)) return raw;
  return { ...raw, blocks: raw.blocks.map(upgradeStoredBlock) };
}

/** A written block read from a stored row (`prompt_block.direction`, `direction_batch.blocks`). */
export const storedBlockSchema = z.preprocess(upgradeStoredBlock, blockSchema);
/** A plan block read from a stored row. */
export const storedPlanBlockSchema = z.preprocess(upgradeStoredBlock, planBlockSchema);
/** A stored continuity bible: the strict schema already drops the legacy `voices[]`. */
export const storedContinuityBibleSchema = continuityBibleSchema;
/** A stored plan (`direction.plan`), fed back to `write_blocks`. */
export const storedDirectorPlanOutputSchema = z.preprocess(
  upgradeStoredOutput,
  directorPlanOutputSchema,
);

/* -------------------------------------------------------------------------- */
/* Input schemas                                                               */
/* -------------------------------------------------------------------------- */

const inputShape = {
  platform_config: platformConfigSchema.default(defaultPlatformConfig),
  block_mode: z.enum(BLOCK_MODES),
  /**
   * The bible as a plain shape (no minimum counts): a compiled bible passed them when it was
   * made, and the stub of a project without one (`stub.ts`) has empty lists by design.
   */
  creative_bible: creativeBibleShape,
  asset_registry: assetRegistrySchema,
  script: z.string().trim().min(1).max(200_000),
  /** write_blocks only: the saved `plan` output, used verbatim (a v1.3 plan is upgraded). */
  plan: storedDirectorPlanOutputSchema.optional(),
  /** write_blocks only, `"9-16"`: inclusive block numbers. */
  block_range: z.string().trim().optional(),
};

function refineMode(
  input: { mode: DirectorMode; plan?: unknown; block_range?: string },
  ctx: z.RefinementCtx,
): void {
  if (input.mode !== "write_blocks") return;
  if (!input.plan) {
    ctx.addIssue({ code: "custom", path: ["plan"], message: "write_blocks needs the saved plan" });
  }
  const range = input.block_range ? parseBlockRange(input.block_range) : null;
  if (!range) {
    ctx.addIssue({
      code: "custom",
      path: ["block_range"],
      message: 'write_blocks needs block_range like "9-16"',
    });
  }
}

/** Input of the `director` dami: `full` or `write_blocks`. */
export const directorInputSchema = z
  .object({ mode: z.enum(["full", "write_blocks"]), ...inputShape })
  .superRefine(refineMode);
export type DirectorInput = z.output<typeof directorInputSchema>;

/** Input of the `director-plan` dami: the plan pass. */
export const directorPlanInputSchema = z.object({ mode: z.literal("plan"), ...inputShape });
export type DirectorPlanInput = z.output<typeof directorPlanInputSchema>;

/** Either input, for the prompt, the checks and the sample generator. */
export type AnyDirectorInput = DirectorInput | DirectorPlanInput;
