import { z } from "zod";
import {
  blockAssetSchema,
  assetRefSchema,
  productionAssetRefsSchema,
  productionPromptSchema,
} from "../shared/block";
import { changeSummaryItemSchema, reviewSchemaFor } from "../shared/reference";
import { projectStyleSchema } from "../shared/style";
import { BLOCK_ISSUE_CODES } from "./issues";

export const blockIssueCodeSchema = z.enum(BLOCK_ISSUE_CODES);

export const blockReviewSchema = reviewSchemaFor(BLOCK_ISSUE_CODES);

export const blockReviserInputSchema = z.object({
  style: projectStyleSchema,
  block: z.object({
    title: z.string().trim().min(1).max(200),
    scriptExcerpt: z.string().trim().min(1).max(20_000),
    /** The prepared prompt under review, with `<<<image_N>>>` tokens. */
    prompt: z.string().trim().min(1).max(8000),
    /** The prepared prompt's references, in token order. */
    assetRefs: z.array(assetRefSchema).max(100),
  }),
  /** The project's ready assets: the only ones that may be referenced. */
  assets: z.array(blockAssetSchema).max(500),
  review: blockReviewSchema,
});

export const blockReviserOutputSchema = z.object({
  prompt: productionPromptSchema,
  assetRefs: productionAssetRefsSchema,
  changeSummary: z.array(changeSummaryItemSchema).min(1),
});

export type BlockReviserInput = z.input<typeof blockReviserInputSchema>;
export type BlockReviserOutput = z.output<typeof blockReviserOutputSchema>;
