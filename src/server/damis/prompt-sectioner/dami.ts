import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { sliceLines, splitLines } from "../shared/script-lines";
import { absorbBlankGaps, checkRangeCoverage } from "./coverage";
import { buildPromptSectionerPrompt } from "./prompt";
import {
  ASSET_TAG_PATTERN,
  promptSectionerInputSchema,
  promptSectionerModelOutputSchema,
  type PromptSectionerOutput,
} from "./schema";

function tagsIn(prompt: string): string[] {
  return [...prompt.matchAll(ASSET_TAG_PATTERN)].map((m) => m[1] ?? "");
}

export const promptSectioner = defineDami({
  key: "prompt-sectioner",
  version: "1.0.0",
  description:
    "Cuts a range of a screenplay into generation blocks of at most 15 seconds, each with a standalone screenplay-style video prompt that tags its assets. Use `sectionScript` for a whole script.",
  input: promptSectionerInputSchema,
  output: promptSectionerModelOutputSchema,
  // Opus: every block prompt drives a paid video generation (about $3 per 15 s draft), so prompt
  // precision and continuity are worth far more than the per-block token cost.
  model: CLAUDE_MODELS.opus,
  effort: "medium",
  // One bounded range per call (see sectionScript), so the output stays well under this.
  maxOutputTokens: 32_000,
  build: buildPromptSectionerPrompt,
  check(output, input) {
    const lines = splitLines(input.content);
    const range = input.range ?? { startLine: 1, endLine: lines.length };
    const issues = checkRangeCoverage(output.blocks, range, lines);
    const known = new Set(input.assets.map((a) => `${a.kind}:${a.slug}`));
    output.blocks.forEach((block, i) => {
      const refs = new Set(block.assetRefs);
      const tags = new Set(tagsIn(block.prompt));
      for (const ref of refs) {
        if (!known.has(ref))
          issues.push(`blocks.${i}: assetRefs has "${ref}", which is not in the asset list`);
        else if (!tags.has(ref))
          issues.push(
            `blocks.${i}: "${ref}" is in assetRefs but never tagged as [${ref}] in the prompt`,
          );
      }
      for (const tag of tags) {
        if (!known.has(tag))
          issues.push(`blocks.${i}: the prompt tags [${tag}], which is not in the asset list`);
        else if (!refs.has(tag))
          issues.push(`blocks.${i}: the prompt tags [${tag}] but assetRefs does not list it`);
      }
    });
    return issues;
  },
  finalize(output, input): PromptSectionerOutput {
    const lines = splitLines(input.content);
    const range = input.range ?? { startLine: 1, endLine: lines.length };
    return {
      blocks: absorbBlankGaps(output.blocks, range).map((block) => ({
        title: block.title,
        scriptExcerpt: sliceLines(lines, block.startLine, block.endLine),
        prompt: block.prompt,
        durationSeconds: block.durationSeconds,
        assetRefs: [...new Set(block.assetRefs)],
        startLine: block.startLine,
        endLine: block.endLine,
      })),
    };
  },
});
