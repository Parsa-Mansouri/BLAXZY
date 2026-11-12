/**
 * The feed of finished asset pictures: every look or sheet that was made (or could not be made)
 * in the user's projects since a cursor. The app polls it to tell the user, wherever they are.
 *
 * It reads the `project_event` rows that `applyGenerationResult`, `failLook` and `failSheet` log
 * in the transaction that settles the look or sheet, so first pictures, fixes and retries all
 * appear.
 *
 * Access path: the user's projects (`project_owner_updated_idx`), then each project's events
 * newer than the cursor (`project_event_project_created_idx`); the remaining joins are by primary
 * key. No new index is needed.
 */
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  asset,
  assetLook,
  assetSheet,
  project,
  projectEvent,
  type AssetKind,
  type Orientation,
} from "@/server/db/schema";

const EVENT_TYPES = {
  "asset.look_ready": { what: "look", ready: true },
  "asset.look_failed": { what: "look", ready: false },
  "asset.sheet_ready": { what: "sheet", ready: true },
  "asset.sheet_failed": { what: "sheet", ready: false },
} as const;

type FinishedEventType = keyof typeof EVENT_TYPES;

export const DEFAULT_FINISHED_PAGE_SIZE = 10;
export const MAX_FINISHED_PAGE_SIZE = 50;

/**
 * An event is listed only once it is this old. Its time is the start of the transaction that
 * logged it, so with several workers a slightly older event can commit after a newer one was
 * already listed; waiting out the (short) transactions keeps the cursor from skipping it.
 */
const SETTLE_SECONDS = 2;

export interface FinishedAssetEvent {
  /** The event's id; stable, so a client can drop repeats. */
  id: string;
  what: "look" | "sheet";
  /** True when the picture was made, false when it could not be. */
  ready: boolean;
  projectId: string;
  projectTitle: string;
  assetId: string;
  assetName: string;
  assetKind: AssetKind;
  /** The picture, for ready events. */
  fileId: string | null;
  /** The picture's shape: sheets are wide, looks follow the film. */
  orientation: Orientation;
  createdAt: Date;
}

export interface FinishedFeedPage {
  /** Oldest first. */
  events: FinishedAssetEvent[];
  /** Pass to the next call. */
  cursor: string;
}

/* -------------------------------------------------------------------------- */
/* Cursor: "<event time, UTC, to the microsecond>_<event id>"                  */
/* -------------------------------------------------------------------------- */

const CURSOR_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Sorts after every event id, so a cursor made from a time alone is past all events at it. */
const LAST_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

/** Postgres keeps microseconds and a JS Date does not, so the time travels as text. */
const utcText = (value: unknown) =>
  sql<string>`to_char(${value} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export function formatFinishedCursor(at: string, id: string): string {
  return `${at}_${id}`;
}

/** The parts of a cursor, or null when it is not one (it comes from the browser). */
export function parseFinishedCursor(cursor: unknown): { at: string; id: string } | null {
  if (typeof cursor !== "string") return null;
  const match = CURSOR_PATTERN.exec(cursor);
  if (!match?.[1] || !match[2] || Number.isNaN(Date.parse(match[1]))) return null;
  return { at: match[1], id: match[2] };
}

/** A cursor at the present: listing from it gives only what finishes from now on. */
export async function finishedFeedCursorNow(): Promise<string> {
  const result = await getDb().execute<{ at: string }>(sql`select ${utcText(sql`now()`)} as at`);
  const row = result.rows[0];
  if (!row) throw new Error("The database did not return the time.");
  return formatFinishedCursor(row.at, LAST_ID);
}

/**
 * Looks and sheets that finished in the user's own (not archived) projects after `cursor`, oldest
 * first, at most `limit`. Without a cursor (or with one that does not parse) it lists nothing and
 * returns a cursor at the present, so what finished earlier is never announced.
 */
export async function listFinishedAssetEvents(
  userId: string,
  cursor: string | null,
  limit = DEFAULT_FINISHED_PAGE_SIZE,
): Promise<FinishedFeedPage> {
  const after = parseFinishedCursor(cursor);
  if (!after) return { events: [], cursor: await finishedFeedCursorNow() };
  const pageSize = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_FINISHED_PAGE_SIZE);

  const afterTime = sql`${after.at}::timestamptz`;
  const rows = await getDb()
    .select({
      id: projectEvent.id,
      type: projectEvent.type,
      at: utcText(projectEvent.createdAt),
      createdAt: projectEvent.createdAt,
      projectId: project.id,
      projectTitle: project.title,
      style: project.style,
      assetId: asset.id,
      assetName: asset.name,
      assetKind: asset.kind,
      lookFileId: assetLook.fileId,
      sheetFileId: assetSheet.fileId,
    })
    .from(project)
    .innerJoin(projectEvent, eq(projectEvent.projectId, project.id))
    .innerJoin(
      asset,
      and(
        eq(asset.id, sql`(${projectEvent.payload}->>'assetId')::uuid`),
        eq(asset.projectId, project.id),
      ),
    )
    .leftJoin(assetLook, eq(assetLook.id, sql`(${projectEvent.payload}->>'lookId')::uuid`))
    .leftJoin(assetSheet, eq(assetSheet.id, sql`(${projectEvent.payload}->>'sheetId')::uuid`))
    .where(
      and(
        eq(project.ownerId, userId),
        isNull(project.archivedAt),
        inArray(projectEvent.type, Object.keys(EVENT_TYPES)),
        // The plain bound is what the (project_id, created_at) index uses; the row comparison
        // then orders events that share a time by id, so none is skipped or repeated.
        gte(projectEvent.createdAt, afterTime),
        sql`(${projectEvent.createdAt}, ${projectEvent.id}) > (${afterTime}, ${after.id}::uuid)`,
        sql`${projectEvent.createdAt} <= now() - make_interval(secs => ${SETTLE_SECONDS})`,
        eq(asset.status, "active"),
      ),
    )
    .orderBy(asc(projectEvent.createdAt), asc(projectEvent.id))
    .limit(pageSize);

  const events = rows.map((row): FinishedAssetEvent => {
    const { what, ready } = EVENT_TYPES[row.type as FinishedEventType];
    return {
      id: row.id,
      what,
      ready,
      projectId: row.projectId,
      projectTitle: row.projectTitle,
      assetId: row.assetId,
      assetName: row.assetName,
      assetKind: row.assetKind,
      fileId: ready ? (what === "look" ? row.lookFileId : row.sheetFileId) : null,
      orientation: what === "sheet" ? "landscape" : (row.style?.orientation ?? "landscape"),
      createdAt: row.createdAt,
    };
  });
  const last = rows.at(-1);
  return {
    events,
    cursor: last
      ? formatFinishedCursor(last.at, last.id)
      : formatFinishedCursor(after.at, after.id),
  };
}
