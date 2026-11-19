import { z } from "zod";
import { creativeBibleShape } from "../creative-dna/schema";
import {
  continuityBibleSchema,
  defaultPlatformConfig,
  platformConfigSchema,
  shotSchema,
  stagingSchema,
  storedBlockSchema,
  CONTINUITY_TYPES,
  SHOT_BUDGETS,
} from "../director/schema";

/* -------------------------------------------------------------------------- */
/* Input                                                                       */
/* -------------------------------------------------------------------------- */

const text = z.string();

const lastWindowSchema = z.string();

/** The block before this one: what its end hands over. */
export const previousNeighbourSchema = z.object({
  end_state: text,
  end_staging: z.array(stagingSchema),
  in_progress_at_end: text,
  last_window: lastWindowSchema,
});

/** The block after this one: what it expects at its start. `continuity_type` is ours (optional). */
export const nextNeighbourSchema = z.object({
  start_state: text,
  start_staging: z.array(stagingSchema),
  continuity_type: z.enum(CONTINUITY_TYPES).optional(),
});

/**
 * The part of the VIDEO_REVIEW report Block Revision reads: the issues the user confirmed or
 * added (routed to "revise") and the windows worth keeping. Other keys of the report are ignored.
 */
export const reviewIssueSchema = z.object({
  issue_id: z.string().min(1),
  cause: text,
  kind: text,
  severity: text,
  window: text,
  planned: text,
  observed: text,
  label: text,
});
export type ReviewIssue = z.output<typeof reviewIssueSchema>;

export const keepItemSchema = z.object({ window: text, what: text });

export const videoReviewSchema = z.object({
  issues: z.array(reviewIssueSchema),
  keep_candidates: z.array(keepItemSchema).default([]),
});

export const timedNoteSchema = z.object({
  from_s: z.number().min(0),
  to_s: z.number().min(0),
  category: z.enum(["directing", "technical", "preference"]),
  note: z.string().trim().min(1),
});
export type TimedNote = z.output<typeof timedNoteSchema>;

export const attemptSchema = z.object({
  block_version: z.number().int(),
  video_version: z.number().int(),
  route: z.enum(["reroll", "rebind", "revise"]),
  fixes: z.array(
    z.object({
      issue_kind: text,
      window: text,
      level: z.number().int().min(1).max(4),
      change: text,
      outcome: z.enum(["fixed", "not_fixed", "new_issue"]),
    }),
  ),
});

/*
 * The owner's request types C (review_options) and E (sliders) are deliberately not part of this
 * input: BLAXZY's decision is that a change request is free text only (director_notes, timed
 * notes, confirmed review issues, asset corrections, regenerate). The prompt still describes C
 * and E, but "only keys in use are sent", so they never appear. The output keeps `slider_state`
 * (the owner's output carries it); with no deltas it is all zeros, and the check enforces that.
 */
export const requestsSchema = z.object({
  asset_correction: z
    .object({
      add: z.array(z.string()).default([]),
      remove: z.array(z.string()).default([]),
      swap: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
    })
    .optional(),
  regenerate: z.boolean().optional(),
  director_notes: z.string().trim().min(1).max(4000).optional(),
  /** Ids of the `video_review.issues` the user confirmed (the issues are in `video_review`). */
  observed_issues: z.array(z.string()).optional(),
});

export const blockRevisionInputSchema = z
  .object({
    ui_language: z.string().trim().min(1).max(40),
    platform_config: platformConfigSchema.default(defaultPlatformConfig),
    /** The bible the Director ran with: a compiled one, or the stub of a project without one. */
    creative_bible: creativeBibleShape,
    continuity_bible: continuityBibleSchema,
    script_excerpt: z.string().trim().min(1).max(20_000),
    neighbours: z.object({
      previous: previousNeighbourSchema.nullable(),
      next: nextNeighbourSchema.nullable(),
    }),
    /** A stored block, so one written by Director v1.3 is upgraded to the current shape. */
    current_block: storedBlockSchema,
    video_review: videoReviewSchema.optional(),
    timed_notes: z.array(timedNoteSchema).optional(),
    keep: z.array(keepItemSchema).optional(),
    attempt_history: z.array(attemptSchema).optional(),
    requests: requestsSchema,
  })
  .superRefine((input, ctx) => {
    const r = input.requests;
    const correction = r.asset_correction;
    const hasAssets =
      correction !== undefined &&
      correction.add.length + correction.remove.length + correction.swap.length > 0;
    const any =
      hasAssets ||
      r.regenerate === true ||
      r.director_notes !== undefined ||
      (r.observed_issues?.length ?? 0) > 0 ||
      (input.timed_notes?.length ?? 0) > 0;
    if (!any) {
      ctx.addIssue({ code: "custom", path: ["requests"], message: "at least one change request" });
    }
    const known = new Set(input.video_review?.issues.map((i) => i.issue_id) ?? []);
    r.observed_issues?.forEach((id, i) => {
      if (!known.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["requests", "observed_issues", i],
          message: `issue "${id}" is not in video_review`,
        });
      }
    });
    input.timed_notes?.forEach((n, i) => {
      if (n.to_s <= n.from_s) {
        ctx.addIssue({
          code: "custom",
          path: ["timed_notes", i],
          message: "to_s must be after from_s",
        });
      }
    });
  });
export type BlockRevisionInput = z.output<typeof blockRevisionInputSchema>;

/* -------------------------------------------------------------------------- */
/* Output                                                                      */
/* -------------------------------------------------------------------------- */

export const FIX_SOURCES = [
  "issue",
  "timed_note",
  "review_option",
  "director_note",
  "slider",
] as const;
export const STRUCTURAL_SUGGESTIONS = [
  "none",
  "split_block",
  "start_frame",
  "reduce_cast_in_frame",
  "manual_review",
] as const;

const sliderValue = z.number().int();

export const blockRevisionOutputSchema = z.object({
  dami: z.literal("block_revision"),
  dami_version: text,
  block_id: z.number().int(),
  version: z.number().int(),
  based_on_version: z.number().int(),
  duration_s: z.number().int(),
  start_state: text,
  end_state: text,
  start_staging: z.array(stagingSchema),
  end_staging: z.array(stagingSchema),
  staging_meaning: text,
  opening_frame: text,
  in_progress_at_end: text,
  camera_rationale: text,
  editing_rationale: text,
  assets: z.object({
    characters: z.array(text),
    locations: z.array(text),
    props: z.array(text),
    heard_only: z.array(text),
  }),
  budgets: z.object({
    spoken_words: z.number().int(),
    spoken_words_max: z.number().int(),
    events: z.number().int(),
    shot_budget: z.enum(SHOT_BUDGETS),
  }),
  shots: z.array(shotSchema),
  applied_rules: z.array(text),
  prompt_text: text,
  word_count: z.number().int(),
  change_log: z.array(text),
  fix_map: z.array(
    z.object({
      source: z.enum(FIX_SOURCES),
      ref: text,
      window: text,
      level: z.number().int(),
      change: text,
    }),
  ),
  expected_checks: z.array(z.object({ window: text, check: text })),
  slider_state: z.object({
    pace: sliderValue,
    camera_energy: sliderValue,
    shot_closeness: sliderValue,
    acting_intensity: sliderValue,
    light_mood: sliderValue,
    music_presence: sliderValue,
    delivery_speed: sliderValue,
    staging_distance: sliderValue,
  }),
  flags: z.object({
    split_required: z.boolean(),
    next_block_needs_update: z.boolean(),
    /** v1.5: a spoken line moved, changed speaker or lost its visible face: bind voices again. */
    voice_rebind_required: z.boolean(),
    structural_suggestion: z.enum(STRUCTURAL_SUGGESTIONS),
    not_applied: z.array(text),
    input_integrity: z.array(text),
  }),
});
export type BlockRevisionOutput = z.output<typeof blockRevisionOutputSchema>;
