import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { checkTokenOrder, checkTokenRange } from "../shared/block";
import { checkFixerOutput } from "../shared/reference";
import { buildTakeFixerPrompt } from "./prompt";
import { takeFixerInputSchema, takeFixerOutputSchema } from "./schema";

export const takeFixer = defineDami({
  key: "take-fixer",
  version: "1.0.0",
  description:
    "Rewrites the prompt of a rejected clip for a retry, addressing each issue of the review and keeping the reference tokens and their order unchanged.",
  input: takeFixerInputSchema,
  output: takeFixerOutputSchema,
  // Opus: the rewritten prompt drives another paid video generation (about $3 for a draft, more
  // for a final). Diagnosing from the review alone why a video model failed, and simplifying the
  // shot without losing the story beat, is subtle work worth the extra tokens.
  model: CLAUDE_MODELS.opus,
  effort: "medium",
  maxOutputTokens: 16_000,
  build: buildTakeFixerPrompt,
  check: (output, input) => [
    ...checkTokenRange(output.prompt, input.assetRefs.length),
    ...checkTokenOrder(output.prompt, input.previousPrompt),
    ...checkFixerOutput(output, input),
  ],
});
