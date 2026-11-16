import { z } from "zod";
import { findCreativeModule } from "./registry";

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

export const DIALOGUE_POLICIES = ["normal", "minimal", "none"] as const;
export const FRAME_ORIENTATIONS = ["portrait", "landscape", "square"] as const;

/**
 * The owner's `ProjectSettings`: the Style answers as DAMI-00 reads them (a movie is a `film`).
 * What the Style stage does not collect yet stays null or absent. The guard is the owner's "cheap
 * guard": a genre id that is not a genre module, or a style id that is not a style module, is
 * refused before any call (the prompt would reject it too, see the regression case t10).
 */
export const creativeDnaInputSchema = z
  .object({
    genre_id: z.string().trim().min(1),
    style_id: z.string().trim().min(1),
    format: z.enum(["film", "series"]),
    episode_count: z.number().int().positive().nullable().optional(),
    episode_duration_sec: z.number().int().positive().nullable().optional(),
    total_duration_sec: z.number().int().positive().nullable().optional(),
    orientation: z.enum(FRAME_ORIENTATIONS),
    audience: z.string().trim().min(1).max(200).nullable().optional(),
    script_language: z.string().trim().min(1).max(40).nullable().optional(),
    ui_language: z.string().trim().min(1).max(40),
    dialogue_policy: z.enum(DIALOGUE_POLICIES).nullable().optional(),
    brief: z.string().max(4000).optional(),
    references: z.array(z.string().max(300)).max(20).optional(),
    locks: z.array(z.string().max(500)).max(20).optional(),
  })
  .superRefine((input, ctx) => {
    const genre = findCreativeModule(input.genre_id);
    if (!genre) {
      ctx.addIssue({
        code: "custom",
        path: ["genre_id"],
        message: `unknown module "${input.genre_id}"`,
      });
    } else if (genre.kind !== "genre") {
      ctx.addIssue({
        code: "custom",
        path: ["genre_id"],
        message: "genre_id must be a genre module",
      });
    }
    const style = findCreativeModule(input.style_id);
    if (!style) {
      ctx.addIssue({
        code: "custom",
        path: ["style_id"],
        message: `unknown module "${input.style_id}"`,
      });
    } else if (style.kind !== "style") {
      ctx.addIssue({
        code: "custom",
        path: ["style_id"],
        message: "style_id must be a style module",
      });
    }
  });

export type CreativeDnaInput = z.output<typeof creativeDnaInputSchema>;

/* -------------------------------------------------------------------------- */
/* Output (output_10, the Creative Bible)                                      */
/* -------------------------------------------------------------------------- */

export const VALIDATION_STATUSES = [
  "ok",
  "ok_with_assumptions",
  "needs_user_decision",
  "rejected",
] as const;
export const RULE_SOURCES = ["genre", "style", "combo", "frame"] as const;
export const REVIEW_POINTS = ["script", "asset", "sheet", "text_block", "video"] as const;
export type ReviewPoint = (typeof REVIEW_POINTS)[number];
export const QC_STAGES = [...REVIEW_POINTS, "all"] as const;
export const ASSET_TYPES = ["character", "location", "prop", "voice", "other"] as const;

const ID_PATTERN = /^[a-z0-9_]+$/;
const idSchema = z.string().regex(ID_PATTERN);

const ruleSchema = z.object({
  id: idSchema,
  rule: z.string().max(300),
  source: z.enum(RULE_SOURCES),
});

const optionSchema = z.object({
  id: idSchema,
  label: z.string(),
  fix_instruction: z.string(),
  target_stage: z.enum(REVIEW_POINTS),
});

// The counts a rejected skeleton cannot meet are checked in `refineBible`.
const reviewPointSchema = z.object({
  technical: z.array(optionSchema).max(7),
  preference: z.array(optionSchema).max(6),
});

/**
 * Nullable fields are required keys holding null (as the prompt's field list shows): optional keys
 * make the structured-output schema ambiguous. No `z.record` anywhere: the structured-output
 * schema must be closed (`additionalProperties: false`).
 */
const projectFrameSchema = z.object({
  format: z.enum(["film", "series", "unknown"]),
  episode_count: z.number().int().min(0).nullable(),
  episode_duration_sec: z.number().int().min(0).nullable(),
  total_duration_sec: z.number().int().min(0).nullable(),
  orientation: z.enum([...FRAME_ORIENTATIONS, "unknown"]),
  audience: z.string().nullable(),
  script_language: z.string().nullable(),
  ui_language: z.string().nullable(),
  dialogue_policy: z.string().nullable(),
  block_length_sec: z.number().int().min(1),
  blocks_per_episode: z.number().int().min(0).nullable(),
  max_spoken_words_per_block: z.number().int().min(0).nullable(),
});

const rulesSchema = z.array(ruleSchema);

const assetAttributesSchema = z.object({
  asset_type: z.enum(ASSET_TYPES),
  attributes: z.array(z.string()),
});
const assetFocusSchema = z.object({
  asset_type: z.enum(ASSET_TYPES),
  focus: z.array(z.string()),
});

const slicesSchema = z.object({
  for_script_writer: z.object({
    rules: rulesSchema,
    beat_guidance: z.array(z.string()),
    // Empty for a film.
    series_rules: rulesSchema,
  }),
  for_script_checker: z.object({ rules: rulesSchema }),
  for_asset_detector: z.object({
    rules: rulesSchema,
    attributes_to_capture: z.array(assetAttributesSchema),
  }),
  for_asset_generation: z.object({
    rules: rulesSchema,
    guided_question_focus: z.array(assetFocusSchema),
  }),
  for_sheet_generator: z.object({
    rules: rulesSchema,
    locks_to_capture: z.array(z.string()),
  }),
  for_director: z.object({ rules: rulesSchema }),
  for_text_blocks_video: z.object({ rules: rulesSchema }),
});

const qcItemSchema = z.object({
  id: idSchema,
  type: z.enum(["criterion", "boundary_test"]),
  source: z.enum(RULE_SOURCES),
  stage: z.enum(QC_STAGES),
  criterion: z.string(),
  how_to_check: z.string(),
});

const conflictSchema = z.object({
  type: z.enum(["genre_style", "lock", "platform", "input_integrity", "selection"]),
  description: z.string(),
  resolution: z.string(),
  needs_user_decision: z.boolean(),
});

const openQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.string()).max(4),
  provisional_default: z.string(),
  affects: z.array(z.string()),
});

export const creativeBibleShape = z.object({
  dami: z.literal("creative_dna"),
  dami_version: z.string(),
  registry_version: z.string(),
  selection: z.object({
    genre_id: z.string().regex(/^genre\./),
    style_id: z.string().regex(/^style\./),
  }),
  project_frame: projectFrameSchema,
  contracts: z.object({
    genre_contract: z.string(),
    style_contract: z.string(),
    combination_logic: z.string(),
  }),
  slices: slicesSchema,
  continuity_locks: z.array(z.string()),
  anti_cliche_guards: z.array(
    z.object({ guard: z.string(), source: z.enum(["genre", "style", "combo"]) }),
  ),
  qc_checklist: z.array(qcItemSchema),
  review_options: z.object({
    script: reviewPointSchema,
    asset: reviewPointSchema,
    sheet: reviewPointSchema,
    text_block: reviewPointSchema,
    video: reviewPointSchema,
  }),
  conflicts: z.array(conflictSchema),
  open_questions: z.array(openQuestionSchema).max(2),
  assumptions: z.array(z.string()),
  validation_status: z.enum(VALIDATION_STATUSES),
});

type BibleShape = z.output<typeof creativeBibleShape>;

/** Slice keys whose `rules` must hold at least three rules in a bible that is not rejected. */
const SLICE_KEYS = [
  "for_script_writer",
  "for_script_checker",
  "for_asset_detector",
  "for_asset_generation",
  "for_sheet_generator",
  "for_director",
  "for_text_blocks_video",
] as const satisfies readonly (keyof BibleShape["slices"])[];

/**
 * The counts the owner's schema sets (the structured-output schema drops them into descriptions,
 * so they are enforced here). A `rejected` bible is the owner's minimal skeleton ("fill nothing
 * else beyond the required skeleton"): it keeps the full shape with empty lists, and only the
 * ceilings and the patterns apply to it.
 */
function refineBible(bible: BibleShape, ctx: z.RefinementCtx): void {
  if (bible.validation_status === "rejected") return;
  const need = (ok: boolean, path: (string | number)[], message: string) => {
    if (!ok) ctx.addIssue({ code: "custom", path, message });
  };
  for (const key of SLICE_KEYS) {
    need(
      bible.slices[key].rules.length >= 3,
      ["slices", key, "rules"],
      "a slice needs at least 3 rules",
    );
  }
  need(
    bible.anti_cliche_guards.length >= 4,
    ["anti_cliche_guards"],
    "at least 4 anti-cliche guards",
  );
  need(bible.qc_checklist.length >= 12, ["qc_checklist"], "at least 12 QC items");
  for (const point of REVIEW_POINTS) {
    const options = bible.review_options[point];
    need(
      options.technical.length >= 4,
      ["review_options", point, "technical"],
      "at least 4 technical options",
    );
    need(
      options.preference.length >= 4,
      ["review_options", point, "preference"],
      "at least 4 preference options",
    );
  }
  bible.open_questions.forEach((q, i) =>
    need(
      q.options.length >= 2,
      ["open_questions", i, "options"],
      "an open question has 2 to 4 options",
    ),
  );
}

/** The Creative Bible: the structured-output schema and the validation of the model's answer. */
export const creativeBibleSchema = creativeBibleShape.superRefine(refineBible);

export type CreativeBible = z.output<typeof creativeBibleSchema>;
export type CreativeRule = z.output<typeof ruleSchema>;
export type CreativeReviewOption = z.output<typeof optionSchema>;
