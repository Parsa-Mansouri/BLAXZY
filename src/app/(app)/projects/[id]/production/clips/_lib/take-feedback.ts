/**
 * Pure helpers of the clip review's findings: which findings and "looks good" points the user left
 * standing, the notes they marked on a time range, and the request these make. No React, no server.
 */
import type { TakeReviewView } from "@/server/production";
import { formatClock } from "./clip-view";

export type Finding = TakeReviewView["findings"][number];
export type KeepPoint = TakeReviewView["keeps"][number];

/** A note about a part of the clip, in seconds. */
export interface TimedNote {
  fromS: number;
  toS: number;
  text: string;
}

/** What the clip review sends when the user asks for changes. */
export interface ChangeRequestInput {
  note?: string;
  confirmedIssueIds: string[];
  keepIds: string[];
  timedNotes: TimedNote[];
}

/** The most notes on time ranges one request carries (the server limit). */
export const MAX_TIMED_NOTES = 20;

/** "0:02.0 to 0:05.4", or "at 0:02.0" for a moment. */
export function rangeLabel(fromS: number, toS: number): string {
  const from = formatClock(fromS);
  return toS - fromS < 0.05 ? `at ${from}` : `${from} to ${formatClock(toS)}`;
}

/** The same set with `id` added, or removed when it was there. */
export function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** A marked range in order and inside the clip; null when it is not a range at all. */
export function normalizeRange(
  fromS: number | null,
  toS: number | null,
  length: number,
): { fromS: number; toS: number } | null {
  if (fromS === null || toS === null) return null;
  if (![fromS, toS].every(Number.isFinite)) return null;
  const cap = length > 0 ? length : Number.POSITIVE_INFINITY;
  const a = Math.min(Math.max(0, Math.min(fromS, toS)), cap);
  const b = Math.min(Math.max(0, Math.max(fromS, toS)), cap);
  const round = (n: number) => Math.round(n * 10) / 10;
  return { fromS: round(a), toS: round(b) };
}

/** The notes with one more added (trimmed text, in order of time); unchanged when it cannot be added. */
export function withTimedNote(
  notes: readonly TimedNote[],
  note: { fromS: number | null; toS: number | null; text: string },
  length: number,
): TimedNote[] {
  const text = note.text.trim();
  const range = normalizeRange(note.fromS, note.toS, length);
  if (!text || !range || notes.length >= MAX_TIMED_NOTES) return [...notes];
  return [...notes, { ...range, text }].sort((x, y) => x.fromS - y.fromS || x.toS - y.toS);
}

/** What the user left standing: findings not dismissed (in list order) and keep points not dropped. */
export function standing(
  review: TakeReviewView,
  dismissed: ReadonlySet<string>,
  dropped: ReadonlySet<string>,
): { findings: Finding[]; keeps: KeepPoint[] } {
  return {
    findings: review.findings.filter((f) => !dismissed.has(f.id)),
    keeps: review.keeps.filter((k) => !dropped.has(k.id)),
  };
}

/** True when the request says what to change: a note, a note on a time range, or a finding. */
export function hasRequest(input: {
  note: string;
  timedNotes: readonly TimedNote[];
  findings: readonly Finding[];
}): boolean {
  return input.note.trim() !== "" || input.timedNotes.length > 0 || input.findings.length > 0;
}

/** The request for the server. */
export function changeRequest(input: {
  note: string;
  timedNotes: readonly TimedNote[];
  findings: readonly Finding[];
  keeps: readonly KeepPoint[];
}): ChangeRequestInput {
  const note = input.note.trim();
  return {
    ...(note ? { note } : {}),
    confirmedIssueIds: input.findings.map((f) => f.id),
    keepIds: input.keeps.map((k) => k.id),
    timedNotes: input.timedNotes.map((n) => ({ ...n })),
  };
}
