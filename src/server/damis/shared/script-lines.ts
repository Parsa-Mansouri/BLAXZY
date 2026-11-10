/**
 * Deterministic line handling for scripts. Damis that point at script passages (reviser,
 * sectioner) refer to 1-based line numbers instead of copying text, so the code can apply and
 * verify their output exactly.
 */

/** Splits a script into lines; CRLF and CR are normalised to LF. */
export function splitLines(content: string): string[] {
  return content.replace(/\r\n?/g, "\n").split("\n");
}

export function normalizeNewlines(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

/** Renders lines as `   12| text`, the format the prompts describe. */
export function numberLines(lines: string[], from = 1, to = lines.length): string {
  const width = String(to).length;
  const out: string[] = [];
  for (let n = from; n <= to; n++) {
    out.push(`${String(n).padStart(width, " ")}| ${lines[n - 1] ?? ""}`);
  }
  return out.join("\n");
}

/** Lines joined back, inclusive 1-based range. */
export function sliceLines(lines: string[], startLine: number, endLine: number): string {
  return lines.slice(startLine - 1, endLine).join("\n");
}

/** Character offset of the start of a 1-based line in the LF-joined script. */
export function lineStartOffset(lines: string[], line: number): number {
  let offset = 0;
  for (let i = 0; i < line - 1; i++) offset += (lines[i]?.length ?? 0) + 1;
  return offset;
}

export function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

const SCENE_HEADING =
  /^\s*(?:\d+[A-Z]?[.)]?\s+)?(?:INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E|INT|EXT|EST)(?:\.|\s|-|$)/;
const EPISODE_HEADING = /^\s*EPISODE\s+\d+\b/i;

export function isSceneHeading(line: string): boolean {
  return SCENE_HEADING.test(line);
}

export function isEpisodeHeading(line: string): boolean {
  return EPISODE_HEADING.test(line);
}

/** A contiguous, inclusive 1-based line range. */
export type LineRange = { startLine: number; endLine: number };

function charCount(lines: string[], range: LineRange): number {
  let n = 0;
  for (let i = range.startLine; i <= range.endLine; i++) n += (lines[i - 1]?.length ?? 0) + 1;
  return n;
}

function rangeIsBlank(lines: string[], range: LineRange): boolean {
  for (let i = range.startLine; i <= range.endLine; i++) if (!isBlank(lines[i - 1])) return false;
  return true;
}

/** Splits an oversized range at blank lines (paragraphs), then at single lines if needed. */
function splitOversized(lines: string[], range: LineRange, maxChars: number): LineRange[] {
  const paragraphs: LineRange[] = [];
  let start = range.startLine;
  for (let i = range.startLine; i <= range.endLine; i++) {
    const endsParagraph = i === range.endLine || (isBlank(lines[i - 1]) && !isBlank(lines[i]));
    if (endsParagraph) {
      paragraphs.push({ startLine: start, endLine: i });
      start = i + 1;
    }
  }
  const pieces: LineRange[] = [];
  for (const p of paragraphs) {
    if (charCount(lines, p) <= maxChars) {
      pieces.push(p);
      continue;
    }
    for (let i = p.startLine; i <= p.endLine; i++) pieces.push({ startLine: i, endLine: i });
  }
  return packRanges(lines, pieces, maxChars);
}

/** Greedily merges consecutive ranges while the total stays within maxChars. */
function packRanges(lines: string[], ranges: LineRange[], maxChars: number): LineRange[] {
  const packed: LineRange[] = [];
  for (const r of ranges) {
    const last = packed.at(-1);
    if (last && charCount(lines, { startLine: last.startLine, endLine: r.endLine }) <= maxChars) {
      last.endLine = r.endLine;
    } else {
      packed.push({ ...r });
    }
  }
  return packed;
}

export type ScriptSegment = LineRange & { index: number };

/**
 * Plans the segments a long script is processed in: scene-aligned, at most ~maxChars each
 * (a single scene longer than that is split at paragraph breaks), never crossing an episode
 * heading. Segments cover every line exactly once, in order; whitespace-only stretches are
 * attached to a neighbour. Deterministic: the same script always gives the same segments.
 */
export function planSegments(content: string, maxChars: number): ScriptSegment[] {
  const lines = splitLines(content);
  const total = lines.length;

  // 1. Scene units: a new unit starts at every scene or episode heading.
  const units: Array<LineRange & { episodeStart: boolean }> = [];
  let start = 1;
  for (let i = 2; i <= total; i++) {
    const line = lines[i - 1] ?? "";
    if (isSceneHeading(line) || isEpisodeHeading(line)) {
      units.push({ startLine: start, endLine: i - 1, episodeStart: false });
      start = i;
    }
  }
  units.push({ startLine: start, endLine: total, episodeStart: false });
  for (const u of units) u.episodeStart = isEpisodeHeading(lines[u.startLine - 1] ?? "");

  // 2. Split oversized units, then pack small consecutive units, breaking at episodes.
  const segments: LineRange[] = [];
  let group: LineRange[] = [];
  const flush = () => {
    segments.push(...packRanges(lines, group, maxChars));
    group = [];
  };
  for (const unit of units) {
    if (unit.episodeStart) flush();
    const pieces =
      charCount(lines, unit) > maxChars ? splitOversized(lines, unit, maxChars) : [unit];
    group.push(...pieces);
  }
  flush();

  // 3. Fold whitespace-only segments into a neighbour (the previous one, or the next if first).
  const merged: LineRange[] = [];
  for (const seg of segments) {
    const last = merged.at(-1);
    if (last && rangeIsBlank(lines, seg)) last.endLine = seg.endLine;
    else if (last && rangeIsBlank(lines, last)) last.endLine = seg.endLine;
    else merged.push({ ...seg });
  }
  return merged.map((s, index) => ({ ...s, index }));
}
