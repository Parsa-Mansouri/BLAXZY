import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { ASSET_TAG_PATTERN } from "../prompt-sectioner/schema";
import { checkBlockPrompt, MAX_REFERENCE_IMAGES } from "../shared/block";
import { buildTextBlocksPrompt } from "./prompt";
import { textBlocksInputSchema, textBlocksOutputSchema } from "./schema";

export const textBlocks = defineDami({
  key: "text-blocks",
  version: "1.0.0",
  description:
    "Turns a sectioned block into the generation-ready video prompt: each asset that has a reference sheet is called by an <<<image_N>>> token placed where the asset is named.",
  input: textBlocksInputSchema,
  output: textBlocksOutputSchema,
  // Opus: this prompt drives a paid video generation (draft and final), so how faithfully it keeps
  // the block's action, camera and sound while binding the right references is worth far more
  // than the token cost of one short rewrite.
  model: CLAUDE_MODELS.opus,
  effort: "medium",
  maxOutputTokens: 16_000,
  build: buildTextBlocksPrompt,
  check(output, input) {
    const issues = checkBlockPrompt(output.prompt, output.assetRefs, input.assets);
    // Nothing available may be dropped silently: when the block fits the limit, every available
    // non-voice asset it names must be referenced.
    const byRef = new Map(input.assets.map((a) => [a.ref, a]));
    const named = new Set<string>(input.block.assetRefs);
    for (const match of input.block.prompt.matchAll(ASSET_TAG_PATTERN)) named.add(match[1] ?? "");
    const wanted = [...named].filter((ref) => {
      const asset = byRef.get(ref);
      return asset !== undefined && asset.kind !== "voice";
    });
    if (wanted.length <= MAX_REFERENCE_IMAGES) {
      for (const ref of wanted) {
        if (!output.assetRefs.includes(ref)) {
          issues.push(
            `"${ref}" is named in the block and available, but is not in assetRefs; reference it`,
          );
        }
      }
    }
    return issues;
  },
});
