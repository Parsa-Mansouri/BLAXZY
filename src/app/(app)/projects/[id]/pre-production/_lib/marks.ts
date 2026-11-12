/**
 * Marks a reviewer drops on the picture while asking for changes. They never reach the server as
 * data: on Send Back they are folded into the note as plain words ("1 (upper left): ..."), so the
 * review contract stays `{ issueCodes, note }`. Positions are fractions (0..1) of the image.
 */

export interface Mark {
  id: string;
  /** 0 = left edge, 1 = right edge of the image. */
  x: number;
  /** 0 = top edge, 1 = bottom edge of the image. */
  y: number;
  text: string;
}

/** The most marks on one picture. */
export const MAX_MARKS = 6;
/** The longest comment on one mark. */
export const MAX_MARK_TEXT = 160;
/** One arrow-key step, and the step with Shift held. */
export const NUDGE = 0.02;
export const NUDGE_FAR = 0.1;

export const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);

/** Which third a fraction falls in: 0, 1 or 2. */
const third = (v: number) => Math.min(2, Math.floor(clamp01(v) * 3));

const ROWS = ["upper", "middle", "lower"] as const;
const COLS = ["left", "centre", "right"] as const;

/** Where a point sits on a 3×3 grid, in words: "upper left", "centre", "lower right". */
export function regionWords(x: number, y: number): string {
  const row = third(y);
  const col = third(x);
  if (row === 1 && col === 1) return "centre";
  return `${ROWS[row]} ${COLS[col]}`;
}

/** The mark moved by a step, kept on the picture. */
export function nudgeMark<M extends Pick<Mark, "x" | "y">>(mark: M, dx: number, dy: number): M {
  return { ...mark, x: clamp01(mark.x + dx), y: clamp01(mark.y + dy) };
}

/** A comment as a sentence: trimmed, one line, ending in punctuation. */
function sentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return /[.!?…]$/.test(flat) ? flat : `${flat}.`;
}

/** The 1-based number of the first mark without a comment, or null when all have one. */
export function firstBlankMark(marks: readonly Pick<Mark, "text">[]): number | null {
  const i = marks.findIndex((m) => m.text.trim().length === 0);
  return i === -1 ? null : i + 1;
}

/**
 * The note with the marks folded in, for the fixer to read:
 *
 *   The lamp is too bright.
 *
 *   Marked on the image:
 *   1 (upper left): the lamp is too bright.
 *   2 (centre): no cup on the table.
 *
 * Marks without a comment are left out (the panel refuses them before this runs).
 */
export function foldMarks(
  note: string,
  marks: readonly Mark[],
  subject: "image" | "sheet",
): string {
  const trimmed = note.trim();
  const lines = marks
    .filter((m) => m.text.trim().length > 0)
    .map((m, i) => `${i + 1} (${regionWords(m.x, m.y)}): ${sentence(m.text)}`);
  if (lines.length === 0) return trimmed;
  const block = [`Marked on the ${subject}:`, ...lines].join("\n");
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

/* ------------------------------------------------------------------------------------------ */
/* Issue groups                                                                                */
/* ------------------------------------------------------------------------------------------ */

export type IssueGroupKey = "subject" | "look" | "frame";

const GROUP_LABELS: Record<IssueGroupKey, string> = {
  subject: "Subject",
  look: "Look",
  frame: "Frame",
};

/**
 * Which group each issue code sits under in the panel (codes from the look and sheet
 * catalogues). A code not listed here falls under Look.
 */
const GROUP_OF: Readonly<Record<string, IssueGroupKey>> = {
  face_incomplete: "subject",
  anatomy_wrong: "subject",
  wrong_age: "subject",
  wrong_clothing: "subject",
  wrong_details: "subject",
  differs_from_look: "subject",
  inconsistent_views: "subject",
  proportions_off: "subject",
  wrong_era: "look",
  wrong_colours: "look",
  style_mismatch: "look",
  lighting_poor: "look",
  text_or_watermark: "look",
  text_or_labels: "look",
  wrong_framing: "frame",
  extra_subjects: "frame",
  background_not_clean: "frame",
  missing_view: "frame",
  layout_cluttered: "frame",
};

/** Issues in their groups (Subject, Look, Frame), catalogue order kept, empty groups dropped. */
export function groupIssues<T extends { code: string }>(
  issues: readonly T[],
): { key: IssueGroupKey; label: string; issues: T[] }[] {
  const order: IssueGroupKey[] = ["subject", "look", "frame"];
  return order
    .map((key) => ({
      key,
      label: GROUP_LABELS[key],
      issues: issues.filter((issue) => (GROUP_OF[issue.code] ?? "look") === key),
    }))
    .filter((group) => group.issues.length > 0);
}
