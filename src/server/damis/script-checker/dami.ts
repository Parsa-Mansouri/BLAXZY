import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { containsQuote } from "../shared/quotes";
import { buildScriptCheckerPrompt } from "./prompt";
import {
  scriptCheckerInputSchema,
  scriptCheckerOutputSchema,
  type ScriptCheckerOutput,
} from "./schema";

export const scriptChecker = defineDami({
  key: "script-checker",
  version: "1.0.0",
  description:
    "Checks an uploaded screenplay for duration fit, generative-video filmability, format, continuity and anything that would block later stages. Reports; never rewrites.",
  input: scriptCheckerInputSchema,
  output: scriptCheckerOutputSchema,
  // Opus: this is a director-level read of a whole script (duration estimate, filmability,
  // continuity) where a missed blocker costs far more than the call; long input, short output.
  model: CLAUDE_MODELS.opus,
  effort: "high",
  maxOutputTokens: 32_000,
  build: buildScriptCheckerPrompt,
  check(output, input) {
    return output.issues.flatMap((issue, i) =>
      containsQuote(input.content, issue.quote)
        ? []
        : [
            `issues.${i}.quote is not a verbatim passage of the script: copy it exactly, or use "" for a whole-script issue`,
          ],
    );
  },
  finalize(output): ScriptCheckerOutput {
    // The verdict follows from the severities, so the UI never sees a contradiction.
    const blocking = output.issues.some((i) => i.severity === "blocker" || i.severity === "major");
    return { ...output, verdict: blocking ? "needs_attention" : "ready" };
  },
});
