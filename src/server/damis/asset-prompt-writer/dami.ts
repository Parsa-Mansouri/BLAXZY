import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildAssetPromptWriterPrompt } from "./prompt";
import { assetPromptWriterInputSchema, assetPromptWriterOutputSchema } from "./schema";

export const assetPromptWriter = defineDami({
  key: "asset-prompt-writer",
  version: "1.0.0",
  description:
    "Writes one image-generation prompt for a single clean reference image of an asset, from the project's style, the script description and the director's prompt or guided answers.",
  input: assetPromptWriterInputSchema,
  output: assetPromptWriterOutputSchema,
  // Sonnet: this is structured-to-prose rewriting with a few precedence rules, not open creative
  // judgement. Sonnet 5.5 follows the rules reliably at half Opus's price, and the prompt is
  // short, so latency matters more than depth.
  model: CLAUDE_MODELS.sonnet,
  effort: "low",
  maxOutputTokens: 8_000,
  build: buildAssetPromptWriterPrompt,
});
