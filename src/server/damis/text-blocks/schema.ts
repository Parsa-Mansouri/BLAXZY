import { z } from "zod";
import { MAX_BLOCK_SECONDS } from "../prompt-sectioner/schema";
import { assetRefSchema } from "../shared/asset-ref";
import {
  blockAssetSchema,
  productionAssetRefsSchema,
  productionPromptSchema,
} from "../shared/block";
import { projectStyleSchema } from "../shared/style";

export const textBlocksInputSchema = z.object({
  style: projectStyleSchema,
  block: z.object({
    title: z.string().trim().min(1).max(200),
    /** The script lines the block covers, verbatim. */
    scriptExcerpt: z.string().trim().min(1).max(20_000),
    /** The sectioner's prompt: assets named inline as `Name [kind:Name]`. */
    prompt: z.string().trim().min(1).max(6000),
    durationSeconds: z.number().int().min(1).max(MAX_BLOCK_SECONDS),
    /** `kind:Name` of the assets tagged in the prompt. */
    assetRefs: z.array(assetRefSchema).max(100),
  }),
  /** The project's ready assets: the only ones that may become references. */
  assets: z.array(blockAssetSchema).max(500),
  /** The block before this one in the film, for continuity. */
  previous: z
    .object({
      title: z.string().trim().min(1).max(200),
      promptTail: z.string().trim().max(3000),
    })
    .optional(),
});

export const textBlocksOutputSchema = z.object({
  prompt: productionPromptSchema,
  assetRefs: productionAssetRefsSchema,
  notes: z
    .array(z.string().trim().min(1).max(400))
    .max(30)
    .describe("Short English notes for the director: what could not be referenced and why."),
});

export type TextBlocksInput = z.input<typeof textBlocksInputSchema>;
export type TextBlocksOutput = z.output<typeof textBlocksOutputSchema>;
