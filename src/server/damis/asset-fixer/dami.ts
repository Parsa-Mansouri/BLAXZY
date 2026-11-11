import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { checkFixerOutput } from "../shared/reference";
import { buildAssetFixerPrompt } from "./prompt";
import { assetFixerInputSchema, assetFixerOutputSchema } from "./schema";

export const assetFixer = defineDami({
  key: "asset-fixer",
  version: "1.0.0",
  description:
    "Rewrites the image prompt of a rejected reference image so the next one fixes what the review asks for, changing nothing else.",
  input: assetFixerInputSchema,
  output: assetFixerOutputSchema,
  // Sonnet: a targeted rewrite of one short prompt against an explicit list of requests. The
  // check below enforces one change-summary entry per request and a prompt that really changed.
  model: CLAUDE_MODELS.sonnet,
  effort: "low",
  maxOutputTokens: 8_000,
  build: buildAssetFixerPrompt,
  check: (output, input) => checkFixerOutput(output, input),
});
