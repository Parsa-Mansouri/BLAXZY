import { z } from "zod";
import { imagePromptSchema, referenceAssetSchema } from "../shared/reference";
import { projectStyleSchema } from "../shared/style";

export const sheetGeneratorInputSchema = z.object({
  style: projectStyleSchema,
  /** The asset; its accepted look is attached to the generation by the caller, not passed here. */
  asset: referenceAssetSchema,
});

export const sheetGeneratorOutputSchema = z.object({
  prompt: imagePromptSchema,
  layout: z
    .string()
    .trim()
    .min(10)
    .max(500)
    .describe(
      "One or two sentences for the director, in English: which views the sheet contains and how they are arranged.",
    ),
});

export type SheetGeneratorInput = z.input<typeof sheetGeneratorInputSchema>;
export type SheetGeneratorOutput = z.output<typeof sheetGeneratorOutputSchema>;
