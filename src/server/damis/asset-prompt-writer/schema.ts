import { z } from "zod";
import { imagePromptSchema, referenceAssetSchema } from "../shared/reference";
import { projectStyleSchema } from "../shared/style";

export const MAX_USER_PROMPT_LENGTH = 4000;

export const assetPromptWriterInputSchema = z
  .object({
    style: projectStyleSchema,
    asset: referenceAssetSchema,
    /** The director's own image prompt. Wins where it conflicts with the script description. */
    userPrompt: z.string().trim().max(MAX_USER_PROMPT_LENGTH).optional(),
    /** Answers to the guided questions (`ASSET_QUESTIONS`), keyed by question id. */
    guidedAnswers: z.record(z.string().min(1).max(64), z.string().trim().max(1000)).optional(),
  })
  .refine(
    (input) =>
      (input.userPrompt ?? "").length > 0 ||
      Object.values(input.guidedAnswers ?? {}).some((answer) => answer.length > 0),
    { message: "give a prompt or at least one guided answer" },
  );

export const assetPromptWriterOutputSchema = z.object({
  prompt: imagePromptSchema,
  notes: z
    .array(z.string().trim().min(1).max(300))
    .max(6)
    .describe(
      "Short notes for the director, in English: a choice made where the input was open, or a conflict resolved. Empty when there is nothing to say.",
    ),
});

export type AssetPromptWriterInput = z.input<typeof assetPromptWriterInputSchema>;
export type AssetPromptWriterOutput = z.output<typeof assetPromptWriterOutputSchema>;
