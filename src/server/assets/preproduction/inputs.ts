/** Input schemas and limits of the pre-production services (pure: no database). */
import { z } from "zod";
import { cleanAssetName, MAX_ASSET_NAME } from "@/server/damis";
import { ASSET_KINDS } from "@/server/db/schema";
import { referenceInputSchema } from "../designs";

/** Longest prompt a user may write for a look (the designers' limit). */
export const MAX_LOOK_PROMPT_LENGTH = 4000;

/** Longest answer to one guided question (the designers' limit). */
export const MAX_GUIDED_ANSWER_LENGTH = 1000;

export const MAX_REVIEW_NOTE_LENGTH = 2000;

export const MAX_ASSET_NAME_LENGTH = MAX_ASSET_NAME;

export const MAX_ASSET_DESCRIPTION_LENGTH = 4000;

export const DEFAULT_CARD_PAGE_SIZE = 24;

export const MAX_CARD_PAGE_SIZE = 100;

/** Most answers one request may carry (more than any designer asks). */
export const MAX_GUIDED_ANSWERS = 40;

/**
 * A second add of the same name (ignoring case) within this many seconds is a double submit: the
 * asset just added is returned instead of a "Name (2)".
 */
export const DUPLICATE_ADD_WINDOW_SECONDS = 10;

export const userIdSchema = z.string().trim().min(1).max(128);

/** An id from the client (checked as a uuid where it is used; bounded here). */
export const idSchema = z.string().max(100);

export const assetRefInput = z.object({ assetId: idSchema, userId: userIdSchema });

export const uploadInput = assetRefInput.extend({ fileId: idSchema });

const promptSchema = z
  .string({ error: "Describe the image you want." })
  .trim()
  .min(3, "Describe the image you want.")
  .max(MAX_LOOK_PROMPT_LENGTH, `Keep the description under ${MAX_LOOK_PROMPT_LENGTH} characters.`);

export const promptInput = assetRefInput.extend({ prompt: promptSchema });

export const answersSchema = z
  .record(
    z.string().max(64, "That is not one of the questions."),
    z
      .string({ error: "Answers must be text." })
      .max(
        MAX_GUIDED_ANSWER_LENGTH,
        `Keep each answer under ${MAX_GUIDED_ANSWER_LENGTH} characters.`,
      ),
    { error: "Answer the questions first." },
  )
  .refine((answers) => Object.keys(answers).length <= MAX_GUIDED_ANSWERS, {
    error: "There are more answers than questions.",
  });

export const guidedInput = assetRefInput.extend({ answers: answersSchema });

const referencesSchema = z.array(referenceInputSchema).max(20);

/**
 * A new design: any mix of the user's words, guided answers and reference photos. With none of
 * them it is "Design it for me" (the designer works from the script and the project).
 */
export const designInput = assetRefInput.extend({
  prompt: promptSchema.optional(),
  answers: answersSchema.optional(),
  references: referencesSchema.optional(),
});

const noteSchema = z
  .string()
  .trim()
  .max(MAX_REVIEW_NOTE_LENGTH, `Keep the note under ${MAX_REVIEW_NOTE_LENGTH} characters.`)
  .optional();

const specEditSchema = z.object({
  field: z.string().trim().min(1).max(200),
  value: z
    .string()
    .trim()
    .min(1, "Write the new value, or leave the field as it is.")
    .max(MAX_GUIDED_ANSWER_LENGTH, `Keep each value under ${MAX_GUIDED_ANSWER_LENGTH} characters.`),
});

export const lookReviewInput = z.object({
  lookId: idSchema,
  userId: userIdSchema,
  decision: z.enum(["accepted", "rejected"], { error: "Accept or reject the image." }),
  note: noteSchema,
  /** Rejected, no words: draw it again as a new variation (same prompt, new seed; no dami call). */
  regenerate: z.boolean().optional(),
  /** Rejected: the next version's photos (a photo replaced or dropped); default: the same. */
  references: referencesSchema.optional(),
  /** Rejected: values the user wrote on the spec card. */
  specEdits: z.array(specEditSchema).max(40).optional(),
  /** Rejected: answers to the designer's non-blocking questions. */
  clarifyAnswers: answersSchema.optional(),
  /** Accepted: the critical inferred spec fields the user checked. */
  confirmedFields: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
});

export const sheetReviewInput = z.object({
  sheetId: idSchema,
  userId: userIdSchema,
  decision: z.enum(["accepted", "rejected"], { error: "Accept or reject the sheet." }),
  /** Rejected: the user's words (the whole request). */
  note: noteSchema,
  /** Rejected, no words: draw it again as a new variation (same prompt, new seed; no dami call). */
  regenerate: z.boolean().optional(),
  /** Rejected: the words are a change of the design, made by the designer (words required). */
  designChange: z.boolean().optional(),
});

export const viewReviewInput = z.object({
  viewRowId: idSchema,
  userId: userIdSchema,
  decision: z.enum(["accepted", "rejected"], { error: "Approve the view or ask for changes." }),
  note: noteSchema,
  regenerate: z.boolean().optional(),
  designChange: z.boolean().optional(),
  /** Accepted: the reviewer approved the parts the view proposes (`new_hypotheses`). */
  hypothesesApproved: z.boolean().optional(),
});

const nameSchema = z
  .string({ error: "Give the asset a name." })
  .trim()
  .min(1, "Give the asset a name.")
  .max(MAX_ASSET_NAME_LENGTH, `Keep the name under ${MAX_ASSET_NAME_LENGTH} characters.`)
  .transform(cleanAssetName)
  .pipe(z.string().min(1, "Use letters or digits in the name."));

const descriptionSchema = z
  .string()
  .trim()
  .max(
    MAX_ASSET_DESCRIPTION_LENGTH,
    `Keep the description under ${MAX_ASSET_DESCRIPTION_LENGTH} characters.`,
  );

export const addInput = z.object({
  projectId: idSchema,
  userId: userIdSchema,
  kind: z.enum(ASSET_KINDS, { error: "Choose what kind of asset this is." }),
  name: nameSchema,
  description: descriptionSchema.optional(),
});

export const updateInput = assetRefInput.extend({
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
});

export const mergeInput = z.object({ keepId: idSchema, mergeId: idSchema, userId: userIdSchema });

export const cardsInput = z.object({
  kind: z.enum(ASSET_KINDS, { error: "Choose a kind of asset." }),
  limit: z.number().int().min(1).max(MAX_CARD_PAGE_SIZE).default(DEFAULT_CARD_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
});
