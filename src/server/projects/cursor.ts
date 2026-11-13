/**
 * Keyset page cursors shared by the list services: opaque base64url text of `|`-separated parts.
 * Decoders return null for anything malformed (the caller throws its module's input error), and
 * check every part fits the column it is compared with, so a forged cursor is an input error
 * instead of a database error. Pure: no database imports.
 */
import { z } from "zod";

const uuid = z.uuid();
/** Postgres `integer`. */
const MAX_INT4 = 2_147_483_647;

/** Microsecond-precise UTC timestamp text, as `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` writes it. */
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;

export function encodeCursor(...parts: (string | number)[]): string {
  return Buffer.from(parts.join("|"), "utf8").toString("base64url");
}

function split(cursor: string, count: number): string[] | null {
  if (cursor.length === 0 || cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  return parts.length === count && parts.every((p) => p.length > 0) ? parts : null;
}

/** A non-negative Postgres integer written in plain decimal digits, else null. */
function int4(text: string): number | null {
  if (!/^\d{1,10}$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n <= MAX_INT4 ? n : null;
}

/** True for a real calendar moment in the timestamp text format (2026-02-30 is not one). */
export function isTimestampText(text: string): boolean {
  const m = TIMESTAMP_PATTERN.exec(text);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year); // years below 100 are not shifted to 19xx
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** `(orderIndex, id)`: story order of blocks. */
export function encodeOrderCursor(orderIndex: number, id: string): string {
  return encodeCursor(orderIndex, id);
}

export function decodeOrderCursor(cursor: string): { orderIndex: number; id: string } | null {
  const parts = split(cursor, 2);
  if (!parts) return null;
  const [order, id] = parts as [string, string];
  const orderIndex = int4(order);
  if (orderIndex === null || !uuid.safeParse(id).success) return null;
  return { orderIndex, id };
}

/** `(timestamp text, id)`: newest-first lists ordered by a timestamp column. */
export function encodeTimestampCursor(timestamp: string, id: string): string {
  return encodeCursor(timestamp, id);
}

export function decodeTimestampCursor(cursor: string): { timestamp: string; id: string } | null {
  const parts = split(cursor, 2);
  if (!parts) return null;
  const [timestamp, id] = parts as [string, string];
  if (!isTimestampText(timestamp) || !uuid.safeParse(id).success) return null;
  return { timestamp, id };
}
