/** Input schemas and limits of Production's services (pure: no database). */
import { z } from "zod";
import { MAX_REFERENCE_IMAGES } from "@/server/damis";
import { MAX_REFERENCES } from "@/server/generation";
import { userIdSchema } from "./access";
import { timedNoteSchema } from "./revision-request";
import { BLOCK_PRODUCTION_STAGES } from "./stage";

/** The most references one take may attach (the engine's limit and the video model's). */
export const MAX_BLOCK_ASSETS = Math.min(MAX_REFERENCES, MAX_REFERENCE_IMAGES);

export const MAX_REVIEW_NOTE_LENGTH = 2000;

export const DEFAULT_BLOCK_PAGE_SIZE = 50;

export const MAX_BLOCK_PAGE_SIZE = 200;

export const projectInput = z.object({ projectId: z.string(), userId: userIdSchema });

export const lineageInput = z.object({ lineageId: z.string(), userId: userIdSchema });

export const takeInput = z.object({ takeId: z.string(), userId: userIdSchema });

/**
 * What the user saw for a step that spends: required (and checked) by the decisions that start a
 * generation, ignored by the ones that do not.
 */
const expectedCredits = z
  .number({ error: "Confirm the price first." })
  .int("Confirm the price first.")
  .min(0, "Confirm the price first.")
  .optional();

const noteSchema = z
  .string()
  .trim()
  .max(MAX_REVIEW_NOTE_LENGTH, `Keep the note under ${MAX_REVIEW_NOTE_LENGTH} characters.`)
  .optional();

export const blockReviewInput = lineageInput.extend({
  decision: z.enum(["accepted", "rejected"], { error: "Approve the shot or ask for changes." }),
  note: noteSchema,
  /** Ask for a new shot plan (needs no note). */
  regenerate: z.boolean().optional(),
});

const issueIds = z.array(z.string().min(1).max(40)).max(50);

/**
 * The user's own words about a rejected clip: a free-text note, notes on a time range, the
 * findings of the clip's review they left standing and the "looks good" points to keep (every one
 * when not given). Nothing from a client but text and ids.
 */
export const takeReviewInput = takeInput.extend({
  decision: z.enum(["accepted", "rejected"], { error: "Accept the clip or ask for changes." }),
  note: noteSchema,
  confirmedIssueIds: issueIds.optional(),
  keepIds: issueIds.optional(),
  timedNotes: z
    .array(
      timedNoteSchema.refine((n) => n.toS >= n.fromS, {
        message: "A note on a time range must end after it starts.",
      }),
    )
    .max(20, "Keep to 20 notes on the clip.")
    .optional(),
  expectedCredits,
});

export const retryTakeInput = takeInput.extend({ expectedCredits });

export const setAssetsInput = lineageInput.extend({
  assetIds: z
    .array(z.string(), { error: "Choose the assets of this shot." })
    .max(MAX_BLOCK_ASSETS, `A shot can use at most ${MAX_BLOCK_ASSETS} assets.`),
});

export const startDraftsInput = projectInput.extend({
  expectedCredits: z
    .number({ error: "Confirm the price first." })
    .int("Confirm the price first.")
    .min(0, "Confirm the price first."),
});

export const listInput = z.object({
  limit: z.number().int().min(1).max(MAX_BLOCK_PAGE_SIZE).default(DEFAULT_BLOCK_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
  stage: z
    .array(z.enum(BLOCK_PRODUCTION_STAGES, { error: "Unknown stage." }))
    .max(BLOCK_PRODUCTION_STAGES.length)
    .optional(),
});
