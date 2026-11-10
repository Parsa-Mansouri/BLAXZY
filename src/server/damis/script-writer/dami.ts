import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { isEpisodeHeading, splitLines } from "../shared/script-lines";
import { countWords, planDuration } from "../shared/style";
import { buildScriptWriterPrompt } from "./prompt";
import { scriptWriterInputSchema, scriptWriterOutputSchema } from "./schema";

/** Below this target, word counts are too noisy to enforce. */
const MIN_TARGET_WORDS_TO_CHECK = 150;
/** Gross deviations only: the prompt asks for ±15%, the check catches a wrong order of magnitude. */
const WORD_RATIO_MIN = 0.4;
const WORD_RATIO_MAX = 2.0;

export const scriptWriter = defineDami({
  key: "script-writer",
  version: "1.0.0",
  description:
    "Writes an original screenplay from a short brief, sized to the project's duration and tailored to its genre, visual style, format and orientation.",
  input: scriptWriterInputSchema,
  output: scriptWriterOutputSchema,
  // Opus: original long-form creative writing is the product here; quality matters more than
  // cost (one call per script version) and the output is long, so it streams.
  model: CLAUDE_MODELS.opus,
  effort: "high",
  // A full feature script plus adaptive thinking; streamed.
  maxOutputTokens: 64_000,
  build: buildScriptWriterPrompt,
  check(output, input) {
    const issues: string[] = [];
    const content = output.content.trim();
    if (!content) {
      if (output.notes.length === 0) {
        issues.push(
          "content is empty: write the screenplay, or explain in notes why it cannot be written",
        );
      }
      return issues;
    }
    const plan = planDuration(input.style);
    const episodeHeadings = splitLines(content).filter(isEpisodeHeading).length;
    if (plan.episodes !== null && episodeHeadings !== plan.episodes) {
      issues.push(
        `content has ${episodeHeadings} "EPISODE n: TITLE" headings but the series has ${plan.episodes} episodes`,
      );
    }
    if (plan.episodes === null && episodeHeadings > 0) {
      issues.push('content is a single film and must not contain "EPISODE" headings');
    }
    if (plan.targetWords >= MIN_TARGET_WORDS_TO_CHECK) {
      const words = countWords(content);
      const ratio = words / plan.targetWords;
      if (ratio < WORD_RATIO_MIN || ratio > WORD_RATIO_MAX) {
        issues.push(
          `content has about ${words} words but the target is about ${plan.targetWords} words for the duration; rewrite it to the target length`,
        );
      }
    }
    return issues;
  },
});
