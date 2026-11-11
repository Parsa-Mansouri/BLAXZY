import { z } from "zod";
import {
  changeSummaryItemSchema,
  imagePromptSchema,
  referenceAssetSchema,
  reviewSchemaFor,
} from "../shared/reference";
import { projectStyleSchema } from "../shared/style";
import { LOOK_ISSUE_CODES } from "./issues";

export const lookIssueCodeSchema = z.enum(LOOK_ISSUE_CODES);

export const lookReviewSchema = reviewSchemaFor(LOOK_ISSUE_CODES);

export const assetFixerInputSchema = z.object({
  style: projectStyleSchema,
  asset: referenceAssetSchema,
  /** The prompt that produced the rejected image. */
  previousPrompt: z.string().trim().min(1).max(6000),
  review: lookReviewSchema,
});

export const assetFixerOutputSchema = z.object({
  prompt: imagePromptSchema,
  changeSummary: z.array(changeSummaryItemSchema).min(1),
});

export type AssetFixerInput = z.input<typeof assetFixerInputSchema>;
export type AssetFixerOutput = z.output<typeof assetFixerOutputSchema>;
