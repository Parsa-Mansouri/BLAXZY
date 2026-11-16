import { z } from "zod";
import { MAX_PROMPT_IMAGES } from "../framework/images";

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Structure the Director owns and this dami only reads (staging, opening frame, shot budget): its
 * exact shape is the Director's. The input is never sent as a structured-output schema, so a loose
 * schema is fine here.
 */
const looseSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);
export type Loose = z.output<typeof looseSchema>;

const idToken = z.string().trim().min(1).max(80);

/** The subset of the Creative Bible (output_10) the review reads. */
export const reviewBibleSchema = z.object({
  anti_cliche_guards: z.array(z.object({ guard: z.string(), source: z.string() })),
  continuity_locks: z.array(z.string()),
  /** The video review options; the dami maps an issue to one so the wizard can pre-tick it. */
  review_options: z
    .object({
      video: z.object({
        technical: z.array(z.object({ id: z.string(), label: z.string() })),
        preference: z.array(z.object({ id: z.string(), label: z.string() })),
      }),
    })
    .optional(),
});

/** The subset of the Continuity Bible (from the Director): descriptors and landmarks. */
export const continuityBibleSchema = z.object({
  descriptors: z.array(looseSchema).default([]),
  landmarks: z.array(looseSchema).default([]),
});

/** One attached reference: `@char_1` is asset `char_1`, optionally with a chosen sheet. */
export const referenceBindingEntrySchema = z.object({
  token: idToken,
  asset_id: idToken,
  /** "" when no sheet was chosen. */
  sheet_id: z.string().default(""),
});
export type ReferenceBindingEntry = z.output<typeof referenceBindingEntrySchema>;

/** One shot of the block: its window (`4-9s`), number and what it plans. */
export const blockShotSchema = z.object({
  window: z.string().trim().min(1),
  shot_number: z.number().int().min(1),
  owner: z.string(),
  shot: z.string(),
  angle: z.string(),
  camera: z.string(),
});

/** The part of the Director's block (output_22) the review needs. */
export const reviewBlockSchema = z.object({
  block_id: z.number().int().min(0),
  version: z.number().int().min(0),
  prompt_text: z.string(),
  shots: z.array(blockShotSchema).min(1).max(12),
  start_staging: looseSchema,
  end_staging: looseSchema,
  opening_frame: looseSchema.optional(),
  /** What is still going on at the last frame (an action the next block must continue). */
  in_progress_at_end: looseSchema.nullable().optional(),
  /** What the block's prompt binds: the expected binding (`reference_binding` is what was sent). */
  assets: z.array(referenceBindingEntrySchema),
  budgets: z.object({ shot_budget: looseSchema.optional() }).optional(),
});
export type ReviewBlock = z.output<typeof reviewBlockSchema>;

/** A sheet image of an asset (a bound one or one that could be confused with it). */
export const reviewSheetSchema = z.object({
  asset_id: idToken,
  /** The asset's display name, e.g. `MOHAMMAD`. */
  name: z.string().trim().min(1).max(120),
  fileId: z.uuid(),
});

/**
 * One extracted keyframe. `label` is the line `planFrames` wrote (`FRAME f07 t=8.0s window 4-9s
 * planned shot 2`): the one place that text is built, so it must start with this frame's id.
 */
export const reviewFrameSchema = z
  .object({
    id: z.string().regex(/^f\d{2,3}$/),
    t: z.number().min(0),
    label: z.string().trim().min(1).max(200),
    fileId: z.uuid(),
  })
  .refine((f) => f.label.startsWith(`FRAME ${f.id} `), {
    message: 'a frame label must start with "FRAME <id> "',
  });
export type ReviewFrame = z.output<typeof reviewFrameSchema>;

export const transcriptSegmentSchema = z.object({
  start_s: z.number().min(0),
  end_s: z.number().min(0),
  text: z.string(),
});

export const generationMetaSchema = z.object({
  model: z.string(),
  seed: z.union([z.number(), z.string()]).nullable().optional(),
  attempt: z.number().int().min(1),
  video_version: z.number().int().min(0),
  /** The clip's length in seconds, when known. */
  duration_s: z.number().positive().optional(),
});

export const videoReviewInputSchema = z
  .object({
    ui_language: z.string().trim().min(1).max(40),
    creative_bible: reviewBibleSchema,
    continuity_bible: continuityBibleSchema.optional(),
    block: reviewBlockSchema,
    reference_binding: z.array(referenceBindingEntrySchema),
    sheets: z.array(reviewSheetSchema).max(20),
    frames: z.array(reviewFrameSchema).min(1).max(28),
    /** The last frame of the accepted previous block (PREV_END). */
    previous_end_frame: z.object({ fileId: z.uuid() }).optional(),
    detected_cuts: z.array(z.object({ t: z.number().min(0) })).max(100),
    transcript: z.array(transcriptSegmentSchema).optional(),
    generation_meta: generationMetaSchema,
  })
  .superRefine((input, ctx) => {
    const images = input.sheets.length + input.frames.length + (input.previous_end_frame ? 1 : 0);
    if (images > MAX_PROMPT_IMAGES) {
      ctx.addIssue({
        code: "custom",
        message: `${images} images do not fit one request (at most ${MAX_PROMPT_IMAGES}); send fewer sheets`,
        path: ["sheets"],
      });
    }
    const ids = input.frames.map((f) => f.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "frame ids must be unique", path: ["frames"] });
    }
  });

export type VideoReviewInput = z.input<typeof videoReviewInputSchema>;
export type VideoReviewParsedInput = z.output<typeof videoReviewInputSchema>;

/* -------------------------------------------------------------------------- */
/* Output (the owner's <output_format>)                                        */
/* -------------------------------------------------------------------------- */

export const WINDOW_STATUSES = ["match", "partial", "miss", "not_checkable"] as const;
export const IDENTITY_RESULTS = [
  "matches_planned",
  "matches_other_asset",
  "matches_none",
  "not_visible",
] as const;
export const ISSUE_CAUSES = ["ai_artifact", "binding_suspect", "instruction_miss"] as const;
export const ISSUE_KINDS = [
  "identity",
  "staging",
  "facing",
  "action",
  "restarted_action",
  "shot_size",
  "camera_move",
  "cuts",
  "default_framing",
  "extra_people",
  "captions",
  "cliche",
  "lock",
  "audio",
  "artifact_face",
  "artifact_hands",
  "artifact_other",
  "location",
  "look",
] as const;
export const ISSUE_SEVERITIES = ["blocker", "major", "minor"] as const;
export const ISSUE_ROUTES = ["reroll", "rebind", "revise"] as const;

export type IssueCause = (typeof ISSUE_CAUSES)[number];
export type IssueKind = (typeof ISSUE_KINDS)[number];
export type IssueRoute = (typeof ISSUE_ROUTES)[number];

/**
 * Structured-output rules: no `z.record`, no optional keys (the owner's empty strings stand for
 * "none"). `.min()` constraints are stripped from the JSON schema the API sees; zod enforces them
 * after the answer.
 */
export const reviewWindowSchema = z.object({
  window: z.string(),
  planned_shot: z.number().int().min(1),
  status: z.enum(WINDOW_STATUSES),
  observed: z.string(),
  differences: z.array(z.string()),
  frames: z.array(z.string()),
});

export const reviewIssueSchema = z.object({
  issue_id: z.string().min(1),
  cause: z.enum(ISSUE_CAUSES),
  kind: z.enum(ISSUE_KINDS),
  severity: z.enum(ISSUE_SEVERITIES),
  from_s: z.number().min(0),
  to_s: z.number().min(0),
  window: z.string(),
  planned: z.string(),
  observed: z.string(),
  evidence: z.array(z.string()),
  review_option_id: z.string(),
  label: z.string().min(1),
  suggested_route: z.enum(ISSUE_ROUTES),
});
export type ReviewIssue = z.output<typeof reviewIssueSchema>;

export const keepCandidateSchema = z.object({
  id: z.string().min(1),
  window: z.string(),
  what: z.string(),
  label: z.string().min(1),
});
export type KeepCandidate = z.output<typeof keepCandidateSchema>;

export const videoReviewOutputSchema = z.object({
  dami: z.enum(["video_review"]),
  dami_version: z.enum(["1.0"]),
  block_id: z.number().int().min(0),
  block_version: z.number().int().min(0),
  video_version: z.number().int().min(0),
  verdict: z.enum(["pass", "needs_fix"]),
  windows: z.array(reviewWindowSchema),
  cuts: z.object({
    planned: z.number().int().min(0),
    detected: z.number().int().min(0),
    planned_times_s: z.array(z.number()),
    detected_times_s: z.array(z.number()),
    status: z.enum(["match", "miss"]),
  }),
  identity: z.array(
    z.object({
      character_id: z.string(),
      window: z.string(),
      result: z.enum(IDENTITY_RESULTS),
      other_asset_id: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      frames: z.array(z.string()),
    }),
  ),
  boundary: z.object({
    opening: z.enum(["match", "partial", "miss"]),
    opening_notes: z.string(),
    restarted_action: z.boolean(),
    vs_prev_end: z.enum(["match", "partial", "miss", "not_given"]),
    ending: z.enum(["match", "partial", "miss"]),
    ending_notes: z.string(),
  }),
  audio: z.object({
    status: z.enum(["checked", "not_checkable"]),
    missing_lines: z.array(z.string()),
    unplanned_speech: z.array(z.string()),
  }),
  issues: z.array(reviewIssueSchema),
  keep_candidates: z.array(keepCandidateSchema),
  not_checkable: z.array(z.string()),
});

export type VideoReviewOutput = z.output<typeof videoReviewOutputSchema>;
