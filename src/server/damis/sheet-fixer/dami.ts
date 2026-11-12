import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { checkFixerOutput } from "../shared/reference";
import { buildSheetFixerPrompt } from "./prompt";
import { sheetFixerInputSchema, sheetFixerOutputSchema } from "./schema";

export const sheetFixer = defineDami({
  key: "sheet-fixer",
  version: "1.0.0",
  description:
    "Rewrites the prompt of a rejected reference sheet so the next one fixes what the review asks for, changing nothing else.",
  input: sheetFixerInputSchema,
  output: sheetFixerOutputSchema,
  // Sonnet: a targeted rewrite of one short prompt against an explicit list of requests. The check enforces one change-summary entry per request.
  model: CLAUDE_MODELS.sonnet,
  effort: "low",
  maxOutputTokens: 8_000,
  build: buildSheetFixerPrompt,
  check: (output, input) => checkFixerOutput(output, input),
});
