/**
 * The maths behind commenting on highlighted text in the review sheet. Pure: no React, no DOM.
 *
 * The sheet renders every line as segments (`<span data-at={offset}>`) whose text is exactly
 * `script.slice(at, at + text.length)`. A selection is read as the segments it touches; from
 * those the selected characters map straight back to offsets in the script.
 */

/** A commented range of the script; `ids` of overlapping comments are kept per segment. */
export interface MarkRange {
  id: string;
  start: number;
  end: number;
}

export interface Segment {
  start: number;
  end: number;
  /** Comments covering this segment, in the order they were given. */
  ids: string[];
}

/**
 * Cuts `[start, end)` at every comment boundary and every extra cut inside it. Each piece
 * carries the comments covering all of it, so overlapping comments simply stack ids.
 */
export function splitSegments(
  start: number,
  end: number,
  marks: readonly MarkRange[],
  cuts: readonly number[] = [],
): Segment[] {
  if (end <= start) return [];
  const points = new Set<number>([start, end]);
  for (const m of marks) {
    if (m.start > start && m.start < end) points.add(m.start);
    if (m.end > start && m.end < end) points.add(m.end);
  }
  for (const c of cuts) if (c > start && c < end) points.add(c);
  const sorted = [...points].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i] as number;
    const e = sorted[i + 1] as number;
    const ids = marks.filter((m) => m.start <= s && m.end >= e && m.end > m.start).map((m) => m.id);
    segments.push({ start: s, end: e, ids });
  }
  return segments;
}

/** How a selection touches one rendered segment, in document order. */
export interface SegmentHit {
  /** The segment's offset in the script. */
  at: number;
  /** Length of its text. */
  length: number;
  /** Where in the segment the selection starts, or null when it starts before the segment. */
  from: number | null;
  /** Where in the segment the selection ends, or null when it ends after the segment. */
  to: number | null;
}

/** The script range covered by the touched segments, before trimming. Null when none. */
export function rangeFromHits(hits: readonly SegmentHit[]): { start: number; end: number } | null {
  const first = hits[0];
  const last = hits[hits.length - 1];
  if (!first || !last) return null;
  const clamp = (v: number, len: number) => Math.min(Math.max(v, 0), len);
  const start = first.at + clamp(first.from ?? 0, first.length);
  const end = last.at + clamp(last.to ?? last.length, last.length);
  return end > start ? { start, end } : null;
}

/** The range without whitespace at either end. Null when nothing but whitespace is left. */
export function trimRange(
  content: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let s = Math.max(0, start);
  let e = Math.min(content.length, end);
  while (s < e && /\s/.test(content[s] as string)) s++;
  while (e > s && /\s/.test(content[e - 1] as string)) e--;
  return e > s ? { start: s, end: e } : null;
}

export type SelectedPassage =
  | { ok: true; start: number; end: number; quote: string }
  | { ok: false; reason: "too-long"; length: number };

/**
 * What a selection would comment on: the trimmed range and its quote. Null for an empty or
 * whitespace-only selection; `too-long` when the passage is over `maxChars` (the server takes
 * quotes of at most 5,000 characters).
 */
export function selectedPassage(
  content: string,
  hits: readonly SegmentHit[],
  maxChars: number,
): SelectedPassage | null {
  const raw = rangeFromHits(hits);
  if (!raw) return null;
  const range = trimRange(content, raw.start, raw.end);
  if (!range) return null;
  const length = range.end - range.start;
  if (length > maxChars) return { ok: false, reason: "too-long", length };
  return { ok: true, ...range, quote: content.slice(range.start, range.end) };
}

/** Index of the last sorted value at or before `offset` (or the first after it, if none is). */
export function nearestAtOrBefore(sorted: readonly number[], offset: number): number {
  if (sorted.length === 0) return -1;
  let lo = 0;
  let hi = sorted.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) <= offset) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found === -1 ? 0 : found;
}

/**
 * Margin notes stacked beside the text: each wants to sit at its anchor's top, in anchor order,
 * and is pushed down just enough not to overlap the note above it. Returns the tops in the
 * input's order.
 */
export function stackTops(
  items: readonly { anchor: number; height: number }[],
  gap: number,
): number[] {
  const order = items
    .map((_, i) => i)
    .sort((a, b) => {
      const d = (items[a] as { anchor: number }).anchor - (items[b] as { anchor: number }).anchor;
      return d !== 0 ? d : a - b;
    });
  const tops = new Array<number>(items.length).fill(0);
  let floor = -Infinity;
  for (const i of order) {
    const item = items[i] as { anchor: number; height: number };
    const top = Math.max(item.anchor, floor);
    tops[i] = top;
    floor = top + item.height + gap;
  }
  return tops;
}

/**
 * The scene the reader is in: the first one crossing the reading band, or the previous answer
 * when none does (between two sections, or past the end).
 */
export function sceneInView(intersecting: readonly boolean[], previous: number): number {
  const i = intersecting.indexOf(true);
  return i === -1 ? previous : i;
}
