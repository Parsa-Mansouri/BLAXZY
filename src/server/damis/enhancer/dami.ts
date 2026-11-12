import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { countWords } from "../shared/style";
import { buildEnhancerPrompt } from "./prompt";
import { enhancerInputSchema, enhancerOutputSchema, type EnhancerOutput } from "./schema";

/** The owner asks for at most 40 words; only clearly longer lines are sent back. */
export const LOOK_LINE_MAX_WORDS = 60;
/** Direction owns time windows such as "[0-4s]". */
const TIMESTAMP = /\[\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*s\s*\]/i;

export function checkEnhancerOutput(
  output: EnhancerOutput,
  input: { genre: string | null; visualStyle: string | null },
): string[] {
  const problems: string[] = [];
  if (output.status === "error") {
    if (output.enhanced_prompt !== null) {
      problems.push('enhanced_prompt must be null when status is "error"');
    }
    if (!output.error?.trim()) {
      problems.push('error must give a short reason when status is "error"');
    }
    return problems;
  }

  const prompt = output.enhanced_prompt?.trim() ?? "";
  if (!prompt) {
    problems.push('enhanced_prompt must be the full rewritten prompt when status is "ok"');
  }
  if (output.error !== null) {
    problems.push('error must be null when status is "ok"');
  }
  if (output.applied.genre !== input.genre) {
    problems.push(
      `applied.genre must be ${JSON.stringify(input.genre)}: the genre given in the input (null when no <genre_rules> are present)`,
    );
  }
  if (output.applied.visual_style !== input.visualStyle) {
    problems.push(
      `applied.visual_style must be ${JSON.stringify(input.visualStyle)}: the visual style given in the input (null when no <style_rules> are present)`,
    );
  }
  if (input.visualStyle === null) {
    if (output.look_line !== null) {
      problems.push("look_line must be null: no visual style is active");
    }
  } else if (!output.look_line?.trim()) {
    problems.push(
      "look_line is required when a visual style is active: one sentence (max 40 words) with the global look",
    );
  } else if (countWords(output.look_line) > LOOK_LINE_MAX_WORDS) {
    problems.push(
      `look_line has ${countWords(output.look_line)} words: shorten it to one sentence of at most 40 words`,
    );
  }
  if (TIMESTAMP.test(prompt)) {
    problems.push(
      'enhanced_prompt contains a time window like "[0-4s]": remove all timestamps and describe the order of events with words like "first", "then", "after a beat"',
    );
  }
  return problems;
}

export const enhancer = defineDami({
  key: "enhancer",
  version: "1.1.0",
  description:
    "Rewrites the user's raw prompt with the selected genre (story layer) and visual style (look layer) into one enhanced prompt plus a global look line for the Direction step.",
  input: enhancerInputSchema,
  output: enhancerOutputSchema,
  // The owner's recommended model.
  model: CLAUDE_MODELS.sonnet,
  // The owner asks for temperature 0.4; the SDK has no temperature, so per docs/damis/README.md
  // ("Settings that differ from the files") anything above 0.3 maps to medium effort.
  effort: "medium",
  // The owner sizes max_tokens at about 2.5 x input tokens + 500. This default covers long
  // multi-scene input; the worker may pass a per-call maxOutputTokens via DamiRunContext.
  maxOutputTokens: 16_000,
  // The owner prefills the assistant turn with "{"; structured JSON output (the schema above)
  // guarantees a JSON object instead.
  build: buildEnhancerPrompt,
  check: checkEnhancerOutput,
});
