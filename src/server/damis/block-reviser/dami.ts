import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { checkBlockPrompt } from "../shared/block";
import { checkFixerOutput } from "../shared/reference";
import { buildBlockReviserPrompt } from "./prompt";
import { blockReviserInputSchema, blockReviserOutputSchema } from "./schema";

export const blockReviser = defineDami({
  key: "block-reviser",
  version: "1.0.0",
  description:
    "Revises a prepared block's prompt and reference list for the director's review, changing only what the review asks for.",
  input: blockReviserInputSchema,
  output: blockReviserOutputSchema,
  // Sonnet: a targeted edit of one prepared prompt against an explicit list of requests, before
  // any video is paid for. The checks enforce valid tokens, one change-summary entry per request
  // and a prompt that really changed.
  model: CLAUDE_MODELS.sonnet,
  effort: "medium",
  maxOutputTokens: 16_000,
  build: buildBlockReviserPrompt,
  check: (output, input) => [
    ...checkBlockPrompt(output.prompt, output.assetRefs, input.assets),
    ...checkFixerOutput(
      { prompt: output.prompt, changeSummary: output.changeSummary },
      { previousPrompt: input.block.prompt, review: input.review },
    ),
  ],
});
