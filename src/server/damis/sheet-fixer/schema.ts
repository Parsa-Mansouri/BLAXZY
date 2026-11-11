import { z } from "zod";
import {
  changeSummaryItemSchema,
  imagePromptSchema,
  referenceAssetSchema,
  reviewSchemaFor,
} from "../shared/reference";
import { projectStyleSchema } from "../shared/style";
import { SHEET_ISSUE_CODES } from "./issues";

export const sheetIssueCodeSchema = z.enum(SHEET_ISSUE_CODES);

export const sheetReviewSchema = reviewSchemaFor(SHEET_ISSUE_CODES);

export const sheetFixerInputSchema = z.object({
  style: projectStyleSchema,
  asset: referenceAssetSchema,
  /** The prompt that produced the rejected sheet. */
  previousPrompt: z.string().trim().min(1).max(6000),
  review: sheetReviewSchema,
});

export const sheetFixerOutputSchema = z.object({
  prompt: imagePromptSchema,
  changeSummary: z.array(changeSummaryItemSchema).min(1),
});

export type SheetFixerInput = z.input<typeof sheetFixerInputSchema>;
export type SheetFixerOutput = z.output<typeof sheetFixerOutputSchema>;
