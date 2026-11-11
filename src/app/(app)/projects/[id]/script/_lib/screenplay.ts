/**
 * Reads a plain-text screenplay into typed lines for display. Pure: no React, no server code.
 *
 * Every line keeps the offsets of its (trimmed) text in the original string, so a selection in
 * the rendered document maps back to the exact characters of the script.
 */

export type ScreenplayLineType =
  | "episode"
  | "scene_heading"
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "transition";

export interface ScreenplayLine {
  type: ScreenplayLineType;
  /** The line's text without its surrounding whitespace. */
  text: string;
  /** Offset of `text` in the script; `script.slice(start, end) === text`. */
  start: number;
  end: number;
  /** A blank line came before this one (or it opens the script). */
  breakBefore: boolean;
}

const SCENE_HEADING = /^(?:INT|EXT|EST|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\s*\/\s*E)[.\s]/i;
const TRANSITION =
  /^(?:FADE (?:IN|OUT|TO BLACK)|CUT TO BLACK|SMASH CUT|MATCH CUT|JUMP CUT|DISSOLVE)\b.*[.:]?$|^[A-Z0-9 '’-]+ TO:$/;
const EPISODE = /^(?:EPISODE|PART|CHAPTER|ACT)\s+(?:\d+|[IVXLC]+)\b/;
const PARENTHETICAL = /^\(.*\)$/;

/** All capitals, at least one letter, no lower-case letters outside a trailing extension. */
function isCue(text: string): boolean {
  const name = text.replace(/\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D|CONT’D|[A-Z.' ’]+)\)\s*$/i, "");
  if (!/[A-Z]/.test(name)) return false;
  if (/[a-z]/.test(name)) return false;
  if (name.length > 40) return false;
  if (/[.!?:;,]$/.test(name)) return false;
  return /^[A-Z0-9 .'’\-&#]+$/.test(name);
}

interface RawLine {
  text: string;
  start: number;
  end: number;
}

function splitLines(script: string): RawLine[] {
  const lines: RawLine[] = [];
  let pos = 0;
  for (;;) {
    const newline = script.indexOf("\n", pos);
    const body = script.slice(pos, newline === -1 ? script.length : newline).replace(/\r$/, "");
    const lead = body.length - body.trimStart().length;
    const text = body.trim();
    lines.push({ text, start: pos + lead, end: pos + lead + text.length });
    if (newline === -1) break;
    pos = newline + 1;
  }
  return lines;
}

/** Splits a screenplay into typed lines. Anything that is not recognised reads as action. */
export function parseScreenplay(script: string): ScreenplayLine[] {
  const raw = splitLines(script);
  const out: ScreenplayLine[] = [];
  let blankBefore = true;
  let inDialogue = false;

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i] as RawLine;
    if (line.text === "") {
      blankBefore = true;
      inDialogue = false;
      continue;
    }
    const next = raw[i + 1];
    const nextHasText = next !== undefined && next.text !== "";
    const upper = line.text === line.text.toUpperCase();
    let type: ScreenplayLineType;

    if (inDialogue) {
      type = PARENTHETICAL.test(line.text) ? "parenthetical" : "dialogue";
    } else if (SCENE_HEADING.test(line.text) && upper) {
      type = "scene_heading";
    } else if (EPISODE.test(line.text) && upper) {
      type = "episode";
    } else if (TRANSITION.test(line.text) && upper) {
      type = "transition";
    } else if (blankBefore && nextHasText && isCue(line.text)) {
      type = "character";
      inDialogue = true;
    } else {
      type = "action";
    }

    out.push({ type, text: line.text, start: line.start, end: line.end, breakBefore: blankBefore });
    blankBefore = false;
  }
  return out;
}

/**
 * Where a quoted passage sits in the script: an exact match first, then one that ignores
 * differences in whitespace (line breaks, double spaces). Null when it is not there.
 */
export function findQuote(script: string, quote: string): { start: number; end: number } | null {
  const needle = quote.trim();
  if (!needle) return null;
  const exact = script.indexOf(needle);
  if (exact !== -1) return { start: exact, end: exact + needle.length };
  const words = needle.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const match = new RegExp(words.join("\\s+")).exec(script);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
