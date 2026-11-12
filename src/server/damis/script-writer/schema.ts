/**
 * The Script Writer v0.2 contract. The output schemas mirror the owner's `submit_screenplay` and
 * `submit_outline` tools (source/script_output.schema.json) field for field; the framework sends
 * them as structured JSON output instead of a forced tool call (same guarantee).
 */
import { z } from "zod";

/* ------------------------------------------------------------------------------------------ */
/* submit_screenplay                                                                           */
/* ------------------------------------------------------------------------------------------ */

export const INT_EXT = ["INT", "EXT", "INT/EXT"] as const;
export const TIMES_OF_DAY = ["DAY", "NIGHT", "DAWN", "DUSK", "CONTINUOUS", "LATER"] as const;
export const BEAT_TYPES = [
  "opening_state",
  "collision",
  "escalation",
  "intervention",
  "turn",
  "ending",
] as const;
export const ELEMENT_TYPES = ["action", "dialogue", "transition"] as const;
export const EXTENSIONS = ["", "V.O.", "O.S."] as const;

export const storyParseSchema = z.object({
  characters: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      want: z.string(),
      relationships: z.string().optional(),
    }),
  ),
  central_action: z.string(),
  fixed_events: z.array(z.string()),
  desired_ending: z.string(),
  unknowns: z.array(z.string()),
});

export const beatSchema = z.object({
  id: z.string(),
  type: z.enum(BEAT_TYPES),
  summary: z.string(),
  genre_effect: z.string(),
  style_effect: z.string(),
});

export const sceneHeadingSchema = z.object({
  int_ext: z.enum(INT_EXT),
  location: z.string().trim().min(1),
  time_of_day: z.enum(TIMES_OF_DAY),
});

export const screenplayElementSchema = z.object({
  type: z.enum(ELEMENT_TYPES),
  text: z.string().optional(),
  character: z.string().optional(),
  extension: z.enum(EXTENSIONS).optional(),
  parenthetical: z.string().optional(),
});

export const screenplaySceneSchema = z.object({
  scene_number: z.number().int().min(1),
  heading: sceneHeadingSchema,
  purpose: z.string(),
  change: z.string(),
  elements: z.array(screenplayElementSchema).min(1),
  estimated_seconds: z.number().int().min(1),
});

export const screenplaySchema = z.object({
  title: z.string(),
  logline: z.string(),
  language: z.string(),
  estimated_duration_seconds: z.number().int(),
  scenes: z.array(screenplaySceneSchema).min(1),
});

export const addedAssumptionSchema = z.object({
  text: z.string(),
  reason: z.string(),
  scene_number: z.number().int(),
});

export const validationSchema = z.object({
  premise_preserved: z.boolean(),
  every_scene_has_goal_and_change: z.boolean(),
  cause_and_effect_clear: z.boolean(),
  genre_effect_traceable: z.boolean(),
  style_effect_traceable: z.boolean(),
  genre_and_style_kept_separate: z.boolean(),
  all_action_visible_or_audible: z.boolean(),
  names_and_props_consistent: z.boolean(),
  elements_valid: z.boolean(),
  no_production_directives: z.boolean(),
  within_duration_budget: z.boolean(),
  notes: z.string(),
});

export const changeLogEntrySchema = z.object({
  scene_number: z.number().int(),
  change: z.string(),
  addresses: z.string(),
});

export const continuityLedgerSchema = z.object({
  introduced_characters: z.array(z.string()).optional(),
  character_states: z
    .array(z.object({ name: z.string(), location: z.string(), visible_state: z.string() }))
    .optional(),
  prop_states: z
    .array(z.object({ name: z.string(), location_or_holder: z.string(), state: z.string() }))
    .optional(),
  open_threads: z.array(z.string()).optional(),
});

/** The owner's `submit_screenplay` input schema. */
export const submitScreenplaySchema = z.object({
  story_parse: storyParseSchema,
  beats: z.array(beatSchema),
  screenplay: screenplaySchema,
  added_assumptions: z.array(addedAssumptionSchema),
  validation: validationSchema,
  warnings: z.array(z.string()),
  change_log: z.array(changeLogEntrySchema).optional(),
  segment_id: z.string().optional(),
  continuity_ledger: continuityLedgerSchema.optional(),
});

/* ------------------------------------------------------------------------------------------ */
/* submit_outline                                                                              */
/* ------------------------------------------------------------------------------------------ */

export const outlineSceneSchema = z.object({
  scene_number: z.number().int().min(1),
  int_ext: z.enum(INT_EXT),
  location: z.string(),
  time_of_day: z.enum(TIMES_OF_DAY),
  characters: z.array(z.string()),
  key_props: z.array(z.string()).optional(),
  purpose: z.string(),
  change: z.string(),
  target_seconds: z.number().int().min(1),
});

export const outlineSequenceSchema = z.object({
  id: z.string().trim().min(1),
  summary: z.string(),
  target_seconds: z.number().int().max(480),
  scenes: z.array(outlineSceneSchema).min(1),
});

export const proposedAdditionSchema = z.object({
  text: z.string(),
  reason: z.string(),
  scene_numbers: z.array(z.number().int()),
});

/** The owner's `submit_outline` input schema. */
export const submitOutlineSchema = z.object({
  logline: z.string(),
  language: z.string().optional(),
  canonical_names: z.object({
    characters: z.array(z.string()),
    locations: z.array(z.string()),
    props: z.array(z.string()),
  }),
  acts: z
    .array(
      z.object({
        act: z.number().int(),
        purpose: z.string(),
        target_seconds: z.number().int(),
        sequences: z.array(outlineSequenceSchema).min(1),
      }),
    )
    .min(1),
  proposed_additions: z.array(proposedAdditionSchema),
  warnings: z.array(z.string()),
});

/* ------------------------------------------------------------------------------------------ */
/* Input                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** The `<project>` block of every mode (the owner's template). Code computes the budget. */
export const writerProjectSchema = z.object({
  /** The owner's genre and style names select the modules (never sent as text otherwise). */
  genre: z.string().trim().min(1).max(500),
  visualStyle: z.string().trim().min(1).max(500),
  format: z.enum(["film", "series_episode"]),
  /** This call's target: the film, one episode, or one sequence (write_segment). */
  targetDurationSeconds: z.number().int().min(1),
  budget: z.object({
    sceneCountRange: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
    dialogueWordBudget: z.number().int().min(0),
    actionBeatBudget: z.number().int().min(0),
    toleranceSeconds: z.number().int().min(0),
  }),
  outputLanguage: z.string().trim().min(1).max(40).optional(),
  audienceRating: z.string().trim().min(1).max(40).optional(),
  /** Defaults to false in the Wizard. */
  creativeExpansion: z.boolean().default(false),
  projectNotes: z.string().trim().min(1).max(4000).optional(),
});

/** The owner's `<feedback>` block (revise mode). */
export const writerFeedbackSchema = z.object({
  issueType: z.enum(["technical", "preference"]),
  selectedReasons: z.array(z.string().trim().min(1).max(60)).max(40),
  customNote: z.string().trim().min(1).max(20_000).optional(),
  scope: z.array(z.number().int().min(1)).max(500).optional(),
});

const story = z.string().trim().min(1).max(40_000);

export const scriptWriterInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("generate"), project: writerProjectSchema, story }),
  z.object({
    mode: z.literal("revise"),
    project: writerProjectSchema,
    previousScreenplay: screenplaySchema,
    feedback: writerFeedbackSchema,
  }),
  z.object({
    mode: z.literal("write_segment"),
    project: writerProjectSchema,
    approvedOutline: submitOutlineSchema.extend({
      /** The proposed additions the user approved (indexes into `proposed_additions`). */
      approved_additions: z.array(z.number().int().min(0)),
    }),
    segmentId: z.string().trim().min(1),
    continuityLedger: continuityLedgerSchema.nullable(),
    previousTail: screenplaySceneSchema.nullable(),
  }),
]);

export const scriptOutlineInputSchema = z.object({
  project: writerProjectSchema,
  story,
  /** Only when re-running after the user rejected the outline. */
  feedback: z.string().trim().min(1).max(20_000).optional(),
});

export type WriterProject = z.input<typeof writerProjectSchema>;
export type WriterFeedback = z.output<typeof writerFeedbackSchema>;
export type ScriptWriterInput = z.input<typeof scriptWriterInputSchema>;
export type ScriptWriterParsedInput = z.output<typeof scriptWriterInputSchema>;
export type ScriptOutlineInput = z.input<typeof scriptOutlineInputSchema>;
export type SubmitScreenplay = z.output<typeof submitScreenplaySchema>;
export type SubmitOutline = z.output<typeof submitOutlineSchema>;
export type Screenplay = z.output<typeof screenplaySchema>;
export type ScreenplayScene = z.output<typeof screenplaySceneSchema>;
export type ScreenplayElement = z.output<typeof screenplayElementSchema>;
export type ContinuityLedger = z.output<typeof continuityLedgerSchema>;
export type ApprovedOutline = SubmitOutline & { approved_additions: number[] };
/** Kept for callers of the old name. */
export type ScriptWriterOutput = SubmitScreenplay;
export const scriptWriterOutputSchema = submitScreenplaySchema;
