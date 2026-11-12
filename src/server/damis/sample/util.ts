/**
 * Helpers for the sample-mode generators: a seeded picker (deterministic for a given input) and
 * light screenplay parsing. Nothing here calls Claude or the database.
 */
import { isEpisodeHeading, isSceneHeading, splitLines } from "../shared/script-lines";

/** FNV-1a, 32 bit. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A deterministic pseudo-random sequence (mulberry32) seeded from text. */
export class Seeded {
  private state: number;

  constructor(seed: string) {
    this.state = hashString(seed) || 1;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("Seeded.pick on an empty list");
    return item;
  }

  /** `count` distinct items, in a seeded order. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < count && pool.length > 0) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0] as T);
    }
    return out;
  }
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cuts at a word boundary and adds an ellipsis when the text is longer than `max`. */
export function truncate(text: string, max: number): string {
  const clean = collapseWhitespace(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

const TRANSITION = /^\s*(FADE (IN|OUT)|CUT TO|DISSOLVE TO|SMASH CUT|MATCH CUT|THE END)\b/i;
const EXTENSION = /\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D|CONT’D|CONT\.?)\)\s*/gi;

export function isTransition(line: string): boolean {
  return TRANSITION.test(line);
}

function hasCase(text: string): boolean {
  return text.toUpperCase() !== text.toLowerCase();
}

/**
 * A character cue: a short line on its own, upper case (scripts without letter case: short and
 * without sentence punctuation), followed by dialogue. Returns the name without extensions such as
 * `(O.S.)`, or null.
 */
export function cueName(lines: string[], index: number): string | null {
  const line = (lines[index] ?? "").trim();
  const next = (lines[index + 1] ?? "").trim();
  const previous = (lines[index - 1] ?? "").trim();
  if (!line || !next || previous !== "") return null;
  if (isSceneHeading(line) || isEpisodeHeading(line) || isTransition(line)) return null;
  if (line.startsWith("(") || line.length > 40) return null;
  const name = line
    .replace(EXTENSION, " ")
    .replace(/\(.*\)/g, " ")
    .trim();
  if (!name || name.split(/\s+/).length > 3) return null;
  if (hasCase(name)) {
    if (name !== name.toUpperCase() || !/[A-Z]/.test(name)) return null;
    if (/[.:!?]$/.test(name)) return null;
  } else if (/[.:!?؟。！？،,]$/.test(name)) {
    return null;
  }
  return name;
}

export type ParsedScene = {
  /** The heading line as written (trimmed), or `Scene N` when the script has no headings. */
  heading: string;
  /** Whether `heading` is a real line of the script. */
  real: boolean;
  /** 1-based inclusive line range, heading included. */
  startLine: number;
  endLine: number;
};

/** Scenes by heading; a script without headings is one positional scene. */
export function parseScenes(content: string): ParsedScene[] {
  const lines = splitLines(content);
  const scenes: ParsedScene[] = [];
  lines.forEach((line, i) => {
    if (isSceneHeading(line)) {
      const previous = scenes.at(-1);
      if (previous) previous.endLine = i;
      scenes.push({ heading: line.trim(), real: true, startLine: i + 1, endLine: lines.length });
    }
  });
  if (scenes.length === 0) {
    scenes.push({ heading: "Scene 1", real: false, startLine: 1, endLine: lines.length });
  }
  return scenes;
}

/** The place in a heading: `EXT. HARBOUR PIER - DUSK` → `HARBOUR PIER`. */
export function headingPlace(heading: string): string {
  return heading
    .replace(/^\s*\d+[A-Z]?[.)]?\s+/, "")
    .replace(/^(INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E|INT|EXT|EST)\.?\s*/i, "")
    .replace(/\s+[-–—]\s+.*$/, "")
    .trim();
}

/** The time in a heading: `EXT. HARBOUR PIER - DUSK` → `dusk`, or null. */
export function headingTime(heading: string): string | null {
  const match = /\s[-–—]\s+(.+)$/.exec(heading);
  return match?.[1] ? match[1].trim().toLowerCase() : null;
}

export function isInterior(heading: string): boolean {
  return /^\s*(?:\d+[A-Z]?[.)]?\s+)?(INT|I\/E)/i.test(heading);
}
