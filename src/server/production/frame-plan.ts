/**
 * Which moments of a generated clip the video review looks at (the owner's <frame_extraction_spec>).
 * Pure: no ffmpeg, no storage. `frames.ts` extracts the planned times.
 *
 * Every planned window gets its first, middle and last frame; one frame is taken 0.3 s after each
 * detected cut; t = 0.1 s and the final frame are always included. Frames closer than 0.15 s are
 * one frame. A clip of up to 15 s keeps at most 16 frames, a longer one at most 28.
 */

export type PlannedWindow = {
  /** The window as the block writes it, e.g. `4-9s`. */
  label: string;
  startS: number;
  endS: number;
  /** The planned shot number of the block (1-based). */
  shot: number;
};

export type DetectedCut = { t: number };

/** Why a frame was picked; also its value when the cap forces a drop (see `DROP_ORDER`). */
export type FrameReason =
  "start" | "end" | "window_first" | "window_last" | "cut" | "window_middle";

export type PlannedFrame = {
  /** `f01`, `f02`, ... in time order. */
  id: string;
  /** Seconds from the start of the clip. */
  t: number;
  reason: FrameReason;
  window: PlannedWindow | null;
  /** The text line that precedes the image in the review message. */
  label: string;
};

/** Frames this close together are one frame (the better-ranked reason is kept). */
export const MIN_FRAME_GAP_S = 0.15;
/** The first frame of every clip. */
export const FIRST_FRAME_S = 0.1;
/** The final frame is taken this long before the end of the clip. */
export const FINAL_FRAME_OFFSET_S = 0.05;
/** A frame is taken this long after a detected cut (the new shot has settled). */
export const CUT_FRAME_DELAY_S = 0.3;
/** First and last frames of a window sit this far inside it (so they are clearly in it). */
export const WINDOW_EDGE_INSET_S = 0.1;
/** A clip of at most this many seconds gets `MAX_FRAMES_SHORT`; a longer one `MAX_FRAMES_LONG`. */
export const SHORT_CLIP_S = 15;
export const MAX_FRAMES_SHORT = 16;
export const MAX_FRAMES_LONG = 28;

/**
 * Keep order, highest first: the two fixed frames, then window edges (the per-window comparison),
 * then cut frames (the cut check), then window middles. When over the cap, the lowest-ranked frames
 * go first; inside one rank the frame with the smallest gap to its neighbours goes first, so the
 * coverage stays even.
 */
const KEEP_RANK: Record<FrameReason, number> = {
  start: 0,
  end: 0,
  window_first: 1,
  window_last: 1,
  cut: 2,
  window_middle: 3,
};

/** `4-9s`, `0-4s`, `4.5-9s` (also `4–9 s`, `4 - 9`); null when it is not a window. */
export function parseWindow(text: string): { startS: number; endS: number } | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:s)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*s?\s*$/i.exec(text);
  if (!match) return null;
  const startS = Number(match[1]);
  const endS = Number(match[2]);
  return endS > startS ? { startS, endS } : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function seconds(n: number): string {
  return Number.isInteger(n) ? String(n) : String(round2(n));
}

/** The window label as the review text shows it: `4-9s`. */
export function windowLabel(startS: number, endS: number): string {
  return `${seconds(startS)}-${seconds(endS)}s`;
}

/** Cap by clip length. */
export function maxFramesFor(durationS: number): number {
  return durationS <= SHORT_CLIP_S ? MAX_FRAMES_SHORT : MAX_FRAMES_LONG;
}

/** The text line before a frame's image: `FRAME f07 t=8.0s window 4-9s planned shot 2`. */
export function frameLabel(id: string, t: number, window: PlannedWindow | null): string {
  const at = `FRAME ${id} t=${t.toFixed(1)}s`;
  return window
    ? `${at} window ${window.label} planned shot ${window.shot}`
    : `${at} outside the planned windows`;
}

type Candidate = { t: number; reason: FrameReason; window: PlannedWindow | null };

/** The window a moment falls in: `start <= t < end`; the last window also owns its end. */
function windowAt(t: number, windows: readonly PlannedWindow[]): PlannedWindow | null {
  const found = windows.find((w) => t >= w.startS && t < w.endS);
  if (found) return found;
  const last = windows[windows.length - 1];
  return last && t === last.endS ? last : null;
}

/** Merges candidates closer than `MIN_FRAME_GAP_S`, keeping the better-ranked (then earlier) one. */
function dedupe(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort(
    (a, b) => a.t - b.t || KEEP_RANK[a.reason] - KEEP_RANK[b.reason],
  );
  const kept: Candidate[] = [];
  for (const c of sorted) {
    const prev = kept[kept.length - 1];
    if (prev && round2(c.t - prev.t) < MIN_FRAME_GAP_S) {
      if (KEEP_RANK[c.reason] < KEEP_RANK[prev.reason]) kept[kept.length - 1] = c;
      continue;
    }
    kept.push(c);
  }
  return kept;
}

/** Drops the lowest-ranked frames until at most `max` remain. The fixed frames are never dropped. */
function trim(candidates: Candidate[], max: number): Candidate[] {
  const list = [...candidates];
  while (list.length > max) {
    const worstRank = Math.max(...list.map((c) => KEEP_RANK[c.reason]));
    if (worstRank === 0) break;
    let victim = -1;
    let victimGap = Infinity;
    list.forEach((c, i) => {
      if (KEEP_RANK[c.reason] !== worstRank) return;
      const before = i > 0 ? c.t - list[i - 1]!.t : Infinity;
      const after = i < list.length - 1 ? list[i + 1]!.t - c.t : Infinity;
      const gap = Math.min(before, after);
      if (gap < victimGap) {
        victimGap = gap;
        victim = i;
      }
    });
    list.splice(victim, 1);
  }
  return list;
}

/**
 * The frames to extract for one clip, in time order, ids `f01..`, each with its label. Windows
 * beyond the clip are ignored and ones that run past it are cut at its end; cuts outside the clip
 * are ignored. A clip with no windows still gets the start, the end and the cut frames.
 */
export function planFrames(input: {
  durationS: number;
  windows: readonly PlannedWindow[];
  cuts: readonly DetectedCut[];
}): PlannedFrame[] {
  const { durationS } = input;
  if (!(durationS > 0)) return [];
  const finalT = round2(Math.max(0, durationS - FINAL_FRAME_OFFSET_S));
  const clamp = (t: number) => round2(Math.min(Math.max(t, 0), finalT));

  const windows = input.windows
    .filter((w) => w.endS > w.startS && w.startS < durationS)
    .map((w) => ({ ...w, endS: Math.min(w.endS, durationS) }))
    .sort((a, b) => a.startS - b.startS);

  const candidates: Candidate[] = [];
  const add = (t: number, reason: FrameReason) =>
    candidates.push({ t: clamp(t), reason, window: windowAt(clamp(t), windows) });

  add(FIRST_FRAME_S, "start");
  add(finalT, "end");
  for (const w of windows) {
    add(w.startS + WINDOW_EDGE_INSET_S, "window_first");
    add(w.endS - WINDOW_EDGE_INSET_S, "window_last");
    add((w.startS + w.endS) / 2, "window_middle");
  }
  for (const cut of input.cuts) {
    if (Number.isFinite(cut.t) && cut.t >= 0 && cut.t < durationS) {
      add(cut.t + CUT_FRAME_DELAY_S, "cut");
    }
  }

  const frames = trim(dedupe(candidates), maxFramesFor(durationS));
  return frames.map((c, i) => {
    const id = `f${String(i + 1).padStart(2, "0")}`;
    return { id, t: c.t, reason: c.reason, window: c.window, label: frameLabel(id, c.t, c.window) };
  });
}
