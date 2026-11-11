/**
 * Sample script-checker: two or three plausible findings that quote real lines of the script
 * (the longest action line, a line of dialogue) plus a duration estimate against the target.
 */
import {
  scriptCheckerInputSchema,
  type ScriptCheckerOutput,
  type ScriptCheckIssue,
} from "../script-checker/schema";
import { isEpisodeHeading, isSceneHeading, splitLines } from "../shared/script-lines";
import { formatSeconds, planDuration, WORDS_PER_MINUTE } from "../shared/style";
import { countWords, cueName, isTransition, Seeded } from "./util";

const MAX_QUOTE = 400;

/** A verbatim piece of a line: whole if short enough, else its start. */
function quoteOf(line: string): string {
  const trimmed = line.trim();
  return trimmed.length <= MAX_QUOTE ? trimmed : trimmed.slice(0, MAX_QUOTE).trim();
}

export function sampleScriptChecker(raw: unknown): ScriptCheckerOutput {
  const input = scriptCheckerInputSchema.parse(raw);
  const lines = splitLines(input.content);
  const rng = new Seeded(JSON.stringify(input));

  const dialogue: string[] = [];
  const action: string[] = [];
  lines.forEach((line, i) => {
    const text = line.trim();
    if (!text || isSceneHeading(text) || isEpisodeHeading(text) || isTransition(text)) return;
    if (cueName(lines, i) !== null || text.startsWith("(")) return;
    const previous = (lines[i - 1] ?? "").trim();
    const isDialogue =
      cueName(lines, i - 1) !== null ||
      (previous.startsWith("(") && cueName(lines, i - 2) !== null);
    (isDialogue ? dialogue : action).push(text);
  });

  const issues: ScriptCheckIssue[] = [];
  const longest = [...action].sort((a, b) => b.length - a.length)[0];
  if (longest) {
    issues.push({
      severity: "minor",
      category: "filmability",
      quote: quoteOf(longest),
      explanation:
        "This action line packs several beats into one moment. A generated shot holds one clear action best; several at once tend to blur or drop details.",
      suggestion:
        "Split it into two or three short action lines, one visible beat each, so each can become its own shot.",
    });
  }
  if (dialogue.length > 0) {
    const line = rng.pick(dialogue);
    issues.push({
      severity: "minor",
      category: "dialogue",
      quote: quoteOf(line),
      explanation:
        "This line says out loud what the scene could show. Spoken lines also need lip-sync in generation, so each one should earn its place.",
      suggestion:
        "Try carrying it with a look, a gesture or an object instead, or shorten it to the few words that matter.",
    });
  }

  const words = countWords(input.content);
  const plan = planDuration(input.style);
  const estimatedSeconds = Math.max(1, Math.round((words / WORDS_PER_MINUTE) * 60));
  const ratio = estimatedSeconds / plan.totalSeconds;
  if (ratio < 0.85 || ratio > 1.15 || issues.length < 2) {
    const over = ratio > 1;
    issues.push({
      severity: ratio < 0.6 || ratio > 1.5 ? "major" : "minor",
      category: "duration",
      quote: "",
      explanation: `At about ${WORDS_PER_MINUTE} words a minute, the script runs roughly ${formatSeconds(estimatedSeconds)} against a target of ${formatSeconds(plan.totalSeconds)}.`,
      suggestion: over
        ? "Trim or merge the least necessary beats, or raise the duration in the Style step."
        : "Deepen existing scenes with a reaction or a visual beat, or lower the duration in the Style step.",
    });
  }

  if (issues.length < 2) {
    issues.push({
      severity: "minor",
      category: "format",
      quote: "",
      explanation:
        "Few scene headings or character cues were found, so later stages will have less to work with when they split the script into shots.",
      suggestion:
        "Use standard scene headings (INT./EXT. PLACE - TIME) and put each speaker's name on its own line above their dialogue.",
    });
  }

  const blocking = issues.some((i) => i.severity === "major" || i.severity === "blocker");
  return {
    verdict: blocking ? "needs_attention" : "ready",
    summary: `Sample check (not run by Claude): about ${words} words, roughly ${formatSeconds(estimatedSeconds)} of screen time against ${formatSeconds(plan.totalSeconds)}. ${issues.length} point${issues.length === 1 ? "" : "s"} to look at.`,
    issues: issues.slice(0, 3),
  };
}
