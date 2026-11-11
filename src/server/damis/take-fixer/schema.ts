import { z } from "zod";
import { MAX_BLOCK_SECONDS } from "../prompt-sectioner/schema";
import { assetRefSchema, productionPromptSchema } from "../shared/block";
import { changeSummaryItemSchema, reviewSchemaFor } from "../shared/reference";
import { projectStyleSchema } from "../shared/style";
import { TAKE_ISSUE_CODES } from "./issues";

export const takeIssueCodeSchema = z.enum(TAKE_ISSUE_CODES);

export const takeReviewSchema = reviewSchemaFor(TAKE_ISSUE_CODES);

export const TAKE_STAGES = ["draft", "final"] as const;

export const takeFixerInputSchema = z.object({
  style: projectStyleSchema,
  block: z.object({
    title: z.string().trim().min(1).max(200),
    scriptExcerpt: z.string().trim().min(1).max(20_000),
    durationSeconds: z.number().int().min(1).max(MAX_BLOCK_SECONDS).optional(),
  }),
  /** The prompt that produced the rejected clip, with its `<<<image_N>>>` tokens. */
  previousPrompt: z.string().trim().min(1).max(8000),
  /** The block's references in token order; the tokens and their order stay as they are. */
  assetRefs: z.array(assetRefSchema).max(9),
  /** Which kind of take was rejected. */
  stage: z.enum(TAKE_STAGES),
  review: takeReviewSchema,
});

export const takeFixerOutputSchema = z.object({
  prompt: productionPromptSchema,
  changeSummary: z.array(changeSummaryItemSchema).min(1),
});

export type TakeFixerInput = z.input<typeof takeFixerInputSchema>;
export type TakeFixerOutput = z.output<typeof takeFixerOutputSchema>;
