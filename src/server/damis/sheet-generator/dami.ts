import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildSheetGeneratorPrompt } from "./prompt";
import { sheetGeneratorInputSchema, sheetGeneratorOutputSchema } from "./schema";

export const sheetGenerator = defineDami({
  key: "sheet-generator",
  version: "1.0.0",
  description:
    "Writes the image-generation prompt for an asset's reference sheet (turnaround, close-ups, details), to be generated with the accepted reference image attached.",
  input: sheetGeneratorInputSchema,
  output: sheetGeneratorOutputSchema,
  // Sonnet: prompt writing from structured input and fixed per-kind view lists, not open
  // creative judgement. Sonnet 5.5 follows the checklists reliably at half Opus's price.
  model: CLAUDE_MODELS.sonnet,
  effort: "low",
  maxOutputTokens: 8_000,
  build: buildSheetGeneratorPrompt,
});
