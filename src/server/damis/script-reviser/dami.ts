import type { z } from "zod";
import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { normalizeNewlines, splitLines } from "../shared/script-lines";
import { applyLineEdits, validateLineEdits } from "./edits";
import { buildScriptReviserPrompt } from "./prompt";
import {
  scriptReviserInputSchema,
  scriptReviserModelOutputSchema,
  type ScriptReviserOutput,
} from "./schema";

type Input = z.output<typeof scriptReviserInputSchema>;

/** The `request` values the change summary must contain, one per review request. */
export function requiredRequests(input: Input): string[] {
  const required: string[] = [...input.review.issueCodes];
  if (input.review.note) required.push("note");
  input.review.comments.forEach((_, i) => required.push(`comment ${i + 1}`));
  return required;
}

export const scriptReviser = defineDami({
  key: "script-reviser",
  version: "1.1.0",
  description:
    "Revises a screenplay from a review (issue codes, a note, anchored comments) with line edits, changing only what the review asks for.",
  input: scriptReviserInputSchema,
  output: scriptReviserModelOutputSchema,
  // Opus: rewriting to a director's notes while keeping voice, continuity and duration is the
  // hardest creative judgement in the pipeline; edits keep the output proportional to the change.
  model: CLAUDE_MODELS.opus,
  effort: "high",
  maxOutputTokens: 64_000,
  build: buildScriptReviserPrompt,
  check(output, input) {
    const issues = validateLineEdits(output.edits, splitLines(input.content).length);
    const required = requiredRequests(input);
    const allowed = new Set([...required, "ripple"]);
    const answered = new Set(output.changeSummary.map((c) => c.request.trim()));
    for (const request of required) {
      if (!answered.has(request)) {
        issues.push(
          `changeSummary has no entry with request "${request}"; every request needs one`,
        );
      }
    }
    for (const request of answered) {
      if (!allowed.has(request)) {
        issues.push(
          `changeSummary request "${request}" is not one of: ${[...allowed].map((r) => `"${r}"`).join(", ")}`,
        );
      }
    }
    const unchanged =
      applyLineEdits(input.content, output.edits) === normalizeNewlines(input.content);
    if (issues.length === 0 && unchanged) {
      issues.push("the edits do not change the script; apply the requested changes");
    }
    return issues;
  },
  finalize(output, input): ScriptReviserOutput {
    return {
      content: applyLineEdits(input.content, output.edits),
      changeSummary: output.changeSummary,
      edits: output.edits,
    };
  },
});
