/**
 * Pure calendar maths for the DatePicker. Dates are ISO `YYYY-MM-DD` strings
 * and are computed in UTC so the result never depends on the machine time zone.
 */

export interface CalendarDay {
  iso: string;
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  inMonth: boolean;
}

/** 0 = Sunday ... 6 = Saturday */
export type WeekStart = 0 | 1 | 6;

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function toISO(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parses a strict ISO date. Returns null for anything invalid (e.g. 2025-02-30). */
export function parseISO(
  value: string | null | undefined,
): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = ISO_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidISO(value: string | null | undefined): value is string {
  return parseISO(value) !== null;
}

function toUTC(iso: string): Date {
  const parsed = parseISO(iso);
  if (!parsed) throw new RangeError(`Invalid ISO date: ${iso}`);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

function fromUTC(date: Date): string {
  return toISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(iso: string, amount: number): string {
  const date = toUTC(iso);
  date.setUTCDate(date.getUTCDate() + amount);
  return fromUTC(date);
}

/** Adds months and clamps the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, amount: number): string {
  const parsed = parseISO(iso);
  if (!parsed) throw new RangeError(`Invalid ISO date: ${iso}`);
  const index = parsed.year * 12 + (parsed.month - 1) + amount;
  const year = Math.floor(index / 12);
  const month = (((index % 12) + 12) % 12) + 1;
  return toISO(year, month, Math.min(parsed.day, daysInMonth(year, month)));
}

export function weekdayOf(iso: string): number {
  return toUTC(iso).getUTCDay();
}

/** Keeps `iso` inside the optional [min, max] range. */
export function clampISO(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

export function isOutOfRange(iso: string, min?: string, max?: string): boolean {
  return Boolean((min && iso < min) || (max && iso > max));
}

/** Today in the user's local time zone, as ISO. */
export function todayISO(now: Date = new Date()): string {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** A fixed 6x7 grid so the calendar never changes height between months. */
export function buildMonthGrid(
  year: number,
  month: number,
  weekStart: WeekStart = 1,
): CalendarDay[][] {
  const first = toISO(year, month, 1);
  const offset = (weekdayOf(first) - weekStart + 7) % 7;
  const weeks: CalendarDay[][] = [];
  let cursor = addDays(first, -offset);
  for (let w = 0; w < 6; w += 1) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const parsed = parseISO(cursor);
      if (!parsed) throw new RangeError("Calendar overflow");
      week.push({
        iso: cursor,
        ...parsed,
        inMonth: parsed.month === month && parsed.year === year,
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Start of the week containing `iso`. */
export function startOfWeek(iso: string, weekStart: WeekStart = 1): string {
  return addDays(iso, -((weekdayOf(iso) - weekStart + 7) % 7));
}

export function endOfWeek(iso: string, weekStart: WeekStart = 1): string {
  return addDays(startOfWeek(iso, weekStart), 6);
}

export function formatDate(
  iso: string,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...options,
  }).format(toUTC(iso));
}

export function formatMonthYear(year: number, month: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Short weekday names starting at `weekStart`. */
export function weekdayLabels(
  weekStart: WeekStart = 1,
  locale?: string,
  width: "narrow" | "short" = "short",
): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: width });
  // 2023-01-01 was a Sunday
  return Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(Date.UTC(2023, 0, 1 + ((weekStart + i) % 7)))),
  );
}
