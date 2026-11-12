/**
 * Sample script-reviser: line edits that visibly answer the review. Each commented passage is
 * reworked in place, each issue code and the note add a beat at a fitting line (the opening, the
 * ending, an action line), and the change summary has one entry per request.
 */
import type { z } from "zod";
import { SCRIPT_ISSUES, type ScriptIssueCode } from "../script-reviser/issues";
import {
  scriptReviserInputSchema,
  type ScriptChangeSummaryItem,
  type ScriptLineEdit,
} from "../script-reviser/schema";
import {
  isBlank,
  isEpisodeHeading,
  isSceneHeading,
  normalizeNewlines,
  splitLines,
} from "../shared/script-lines";
import { collapseWhitespace, cueName, isTransition, truncate } from "./util";

type Input = z.output<typeof scriptReviserInputSchema>;
type ModelOutput = { edits: ScriptLineEdit[]; changeSummary: ScriptChangeSummaryItem[] };

/** The beat each issue code adds (screenplay action lines). */
const ISSUE_BEATS: Record<ScriptIssueCode, string> = {
  pacing_slow: "We are already mid-motion: no lead-in, the scene starts on the action.",
  pacing_rushed: "A held beat. Nobody moves. The moment is allowed to land.",
  too_long: "The surrounding beats now play as one continuous, tighter shot.",
  too_short: "A small complication: a door sticks, a hand hesitates, and the scene breathes.",
  opening_weak:
    "Close on a trembling hand, then a hard cut to black and back: the story starts here.",
  ending_weak: "A last image lingers: the light changes, and the choice is finally made.",
  dialogue_unnatural: "(beat, then simpler) Yeah. I know.",
  too_much_dialogue: "Instead of answering, a look says it all.",
  too_little_dialogue: "(quietly) I should have said something sooner.",
  tone_off: "The light shifts to match the mood the story needs.",
  character_unclear: "What they want is plain now: they reach for it, then stop themselves.",
  plot_hole: "A small detail planted here explains what happens later.",
  not_visual: "Rain on the glass, breath on the window: the feeling is shown, not said.",
  hard_to_film: "Kept simple for the camera: two people, one frame, no crowd.",
  too_many_characters: "The minor roles are merged: one familiar face carries the moment.",
  too_many_locations: "The scene stays in this one place; nothing moves elsewhere.",
  formatting: "(Formatting tidied: headings, cues and dialogue follow the standard layout.)",
};

const NUMBERED = /^(\s*\d+)\|/;

function clean(text: string, max: number): string {
  return truncate(collapseWhitespace(text), max).replace(NUMBERED, "$1:");
}

function lineOfOffset(content: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, content.length));
  let line = 1;
  for (let i = 0; i < clamped; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/** The 1-based line range of a commented passage: by its quote, else by its offsets. */
function commentRange(content: string, quote: string, start: number, end: number) {
  let from = content.indexOf(quote, Math.max(0, start - 200));
  if (from < 0) from = content.indexOf(quote);
  const startOffset = from >= 0 ? from : start;
  const endOffset = from >= 0 ? from + quote.length : Math.max(start, end);
  const startLine = lineOfOffset(content, startOffset);
  return {
    startLine,
    endLine: Math.max(startLine, lineOfOffset(content, Math.max(startOffset, endOffset - 1))),
  };
}

function isActionLine(lines: string[], index: number): boolean {
  const text = (lines[index] ?? "").trim();
  if (!text || isSceneHeading(text) || isEpisodeHeading(text) || isTransition(text)) return false;
  if (text.startsWith("(") || cueName(lines, index) !== null) return false;
  return cueName(lines, index - 1) === null && cueName(lines, index - 2) === null;
}

export function sampleScriptReviser(raw: unknown): ModelOutput {
  const input: Input = scriptReviserInputSchema.parse(raw);
  const content = normalizeNewlines(input.content);
  const lines = splitLines(content);
  const count = lines.length;
  const nonBlank = lines.flatMap((l, i) => (isBlank(l) ? [] : [i + 1]));
  const firstLine = nonBlank[0] ?? 1;
  const lastContent =
    [...nonBlank].reverse().find((n) => !isTransition(lines[n - 1] ?? "")) ??
    nonBlank.at(-1) ??
    count;
  const actionLines = lines.flatMap((_, i) => (isActionLine(lines, i) ? [i + 1] : []));
  const anchors = actionLines.length > 0 ? actionLines : nonBlank.length > 0 ? nonBlank : [1];

  /** Lines that are replaced (kept, with additions after them) and what is added after each. */
  const touched = new Set<number>();
  const after = new Map<number, string[]>();
  const replaced = new Map<number, string>();
  const add = (line: number, text: string) => {
    touched.add(line);
    after.set(line, [...(after.get(line) ?? []), "", text]);
  };

  const summary: ScriptChangeSummaryItem[] = [];

  input.review.issueCodes.forEach((code, i) => {
    const line =
      code === "opening_weak" || code === "pacing_slow"
        ? (actionLines[0] ?? firstLine)
        : code === "ending_weak"
          ? lastContent
          : (anchors[(i * 3 + 1) % anchors.length] ?? firstLine);
    add(line, ISSUE_BEATS[code]);
    summary.push({
      request: code,
      change: clean(
        `${SCRIPT_ISSUES[code].label}: added a beat after line ${line} (“${ISSUE_BEATS[code]}”).`,
        600,
      ),
    });
  });

  if (input.review.note) {
    const line = anchors[Math.floor(anchors.length / 2)] ?? firstLine;
    const note = clean(input.review.note, 200);
    add(line, `Reworked for the director's note: ${note}`);
    summary.push({
      request: "note",
      change: clean(`Answered the note (“${note}”) with a new beat after line ${line}.`, 600),
    });
  }

  input.review.comments.forEach((comment, i) => {
    const range = commentRange(content, comment.quote, comment.start, comment.end);
    const endLine = Math.min(count, range.endLine);
    const startLine = Math.min(endLine, range.startLine);
    for (let n = startLine; n <= endLine; n++) touched.add(n);
    // Rework the commented line itself: keep its words, mark the delivery the comment asks for.
    const original = lines[startLine - 1] ?? "";
    const tone = clean(comment.note, 80)
      .replace(/[.!?…]+$/, "")
      .toLowerCase();
    if (original.trim() && !replaced.has(startLine)) {
      replaced.set(startLine, `${original.trimEnd()} (${tone})`);
    } else {
      add(endLine, `(${tone})`);
    }
    summary.push({
      request: `comment ${i + 1}`,
      change: clean(
        `Reworked lines ${startLine}-${endLine} (“${truncate(comment.quote, 80)}”) to read ${tone}.`,
        600,
      ),
    });
  });

  // Group touched lines into contiguous, ordered, non-overlapping edits.
  const sorted = [...touched].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
  const edits: ScriptLineEdit[] = [];
  for (const n of sorted) {
    const last = edits.at(-1);
    if (last && n === last.endLine + 1) last.endLine = n;
    else edits.push({ startLine: n, endLine: n, replacement: "" });
  }
  for (const edit of edits) {
    const out: string[] = [];
    for (let n = edit.startLine; n <= edit.endLine; n++) {
      out.push(replaced.get(n) ?? lines[n - 1] ?? "");
      out.push(...(after.get(n) ?? []));
    }
    edit.replacement = out.map((l) => l.replace(NUMBERED, "$1:")).join("\n");
  }
  if (edits.length === 0) {
    edits.push({
      startLine: count,
      endLine: count,
      replacement: `${lines[count - 1] ?? ""}\n\n(Revised.)`,
    });
  }
  return { edits, changeSummary: summary };
}
