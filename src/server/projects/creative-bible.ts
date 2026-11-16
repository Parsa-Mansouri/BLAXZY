/**
 * The project's Creative Bible (DAMI-00 Creative DNA): requested when the Style is saved, compiled
 * by the worker, read by the later damis. Versions are append-only; a newer one marks the older
 * rows `superseded` (a status update, like script versions and looks).
 */
import { and, desc, eq, isNull, max, ne } from "drizzle-orm";
import {
  creativeBibleKey,
  creativeBibleSchema,
  creativeDnaInputFromStyle,
  registryIdsForStyle,
  type CreativeBible,
  type CreativeDnaInput,
} from "@/server/damis";
import { getDb, type DbExecutor, type DbTx } from "@/server/db/client";
import { creativeBible, project, type ProjectStyle } from "@/server/db/schema";
import { enqueue, projectCreativeDna } from "@/server/jobs";
import { logProjectEvent } from "./events";
import { uuidSchema } from "./schemas";

export type CreativeBibleRow = typeof creativeBible.$inferSelect;

/** A stored bible that passed the output schema, with the row facts later damis may need. */
export type ReadyCreativeBible = {
  id: string;
  versionNumber: number;
  genreId: string;
  styleId: string;
  bible: CreativeBible;
};

/** Marks every row of the project that is not superseded yet as superseded. */
async function supersedePrevious(tx: DbTx, projectId: string): Promise<string[]> {
  const rows = await tx
    .update(creativeBible)
    .set({ status: "superseded" })
    .where(and(eq(creativeBible.projectId, projectId), ne(creativeBible.status, "superseded")))
    .returning({ id: creativeBible.id });
  return rows.map((r) => r.id);
}

/**
 * Adds the next pending bible for the style and supersedes the older ones, in the caller's
 * transaction (the caller holds the project's row lock, which serializes version numbers). Returns
 * null, after superseding the older rows, when the style gets no bible (a typed "Other" genre or
 * visual style). Does not queue the job: use `refreshCreativeBible`.
 */
export async function requestCreativeBible(
  tx: DbTx,
  input: { projectId: string; style: ProjectStyle },
): Promise<CreativeBibleRow | null> {
  const ids = registryIdsForStyle(input.style);
  await supersedePrevious(tx, input.projectId);
  if (!ids) return null;
  const [last] = await tx
    .select({ latest: max(creativeBible.versionNumber) })
    .from(creativeBible)
    .where(eq(creativeBible.projectId, input.projectId));
  const [row] = await tx
    .insert(creativeBible)
    .values({
      projectId: input.projectId,
      versionNumber: (last?.latest ?? 0) + 1,
      genreId: ids.genreId,
      styleId: ids.styleId,
      styleSnapshot: input.style,
    })
    .returning();
  if (!row) throw new Error("The Creative Bible row was not created");
  return row;
}

/**
 * Called by `saveStyle` in its transaction. Requests a bible (and queues its job) when the style
 * is saved for the first time, when what a bible depends on changed (genre, visual style, format,
 * orientation, durations, language), or when the project has no usable one (the last failed, or
 * none exists yet). A style with no module (typed "Other") supersedes the old bible and queues
 * nothing. Returns the new row, or null when nothing was requested.
 */
export async function refreshCreativeBible(
  tx: DbTx,
  input: { projectId: string; userId: string; previous: ProjectStyle | null; style: ProjectStyle },
): Promise<CreativeBibleRow | null> {
  const key = creativeBibleKey(input.style);
  if (key === null) {
    const dropped = await supersedePrevious(tx, input.projectId);
    if (dropped.length > 0) {
      await logProjectEvent(tx, {
        projectId: input.projectId,
        userId: input.userId,
        type: "creative_bible.superseded",
        payload: { reason: "no-module-for-style", bibleIds: dropped },
      });
    }
    return null;
  }
  const latest = await getLatestBible(input.projectId, tx);
  const changed = input.previous === null || creativeBibleKey(input.previous) !== key;
  const usable = latest !== null && (latest.status === "pending" || latest.status === "ready");
  if (!changed && usable) return null;
  const row = await requestCreativeBible(tx, { projectId: input.projectId, style: input.style });
  if (!row) return null;
  await logProjectEvent(tx, {
    projectId: input.projectId,
    userId: input.userId,
    type: "creative_bible.requested",
    payload: {
      bibleId: row.id,
      versionNumber: row.versionNumber,
      genreId: row.genreId,
      styleId: row.styleId,
    },
  });
  await enqueue(projectCreativeDna, { bibleId: row.id }, { tx });
  return row;
}

/** The project's newest bible row of any status (null when it has none). */
export async function getLatestBible(
  projectId: string,
  db: DbExecutor = getDb(),
): Promise<CreativeBibleRow | null> {
  if (!uuidSchema.safeParse(projectId).success) return null;
  const [row] = await db
    .select()
    .from(creativeBible)
    .where(eq(creativeBible.projectId, projectId))
    .orderBy(desc(creativeBible.versionNumber))
    .limit(1);
  return row ?? null;
}

/**
 * The bible later damis follow: the newest row that is `ready` (superseded rows are never
 * returned), or null while the first one is compiling, after a failure, or for a style with no
 * module. A stored bible that no longer passes the schema reads as none.
 */
export async function getReadyBible(
  projectId: string,
  db: DbExecutor = getDb(),
): Promise<ReadyCreativeBible | null> {
  if (!uuidSchema.safeParse(projectId).success) return null;
  const [row] = await db
    .select()
    .from(creativeBible)
    .where(and(eq(creativeBible.projectId, projectId), eq(creativeBible.status, "ready")))
    .orderBy(desc(creativeBible.versionNumber))
    .limit(1);
  if (!row) return null;
  const parsed = creativeBibleSchema.safeParse(row.bible);
  if (!parsed.success) return null;
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    genreId: row.genreId,
    styleId: row.styleId,
    bible: parsed.data,
  };
}

/** How long a job waits for a bible that is still compiling, counted from the row's creation. */
export const BIBLE_WAIT_LIMIT_MS = 10 * 60_000;
/** How long a job that has to wait is deferred before it looks again. */
export const BIBLE_WAIT_RETRY_MS = 20_000;

/** What a job about to run a consuming dami does about the project's Creative Bible. */
export type BibleForRun =
  | { kind: "ready"; bible: ReadyCreativeBible }
  /** The bible is still compiling and is young enough to wait for: defer the job. */
  | { kind: "wait" }
  /** No bible to use (none, failed, superseded, timed out or unreadable): run without one. */
  | { kind: "none"; reason: "none" | "failed" | "superseded" | "timed_out" | "unreadable" };

/**
 * Decides what a dami job does about the project's bible, from its newest row: `ready` → use it;
 * `pending` → wait while the row is younger than `BIBLE_WAIT_LIMIT_MS`, then give up; `failed`,
 * `superseded` (a typed "Other" style) or no row → none. The job never waits on a row that
 * cannot finish, and never longer than the limit.
 */
export async function bibleForRun(
  projectId: string,
  options: { now?: Date; db?: DbExecutor } = {},
): Promise<BibleForRun> {
  const db = options.db ?? getDb();
  const latest = await getLatestBible(projectId, db);
  if (!latest) return { kind: "none", reason: "none" };
  if (latest.status === "pending") {
    const age = (options.now ?? new Date()).getTime() - latest.createdAt.getTime();
    return age < BIBLE_WAIT_LIMIT_MS ? { kind: "wait" } : { kind: "none", reason: "timed_out" };
  }
  if (latest.status !== "ready") return { kind: "none", reason: latest.status };
  const bible = await getReadyBible(projectId, db);
  return bible ? { kind: "ready", bible } : { kind: "none", reason: "unreadable" };
}

/* ---------------------------- worker only/* ---------------------------- worker only ---------------------------------- */

export type CreativeBibleJob = {
  row: CreativeBibleRow;
  project: { id: string; ownerId: string };
  /** The dami input for the stored style, or null when the style has no module. */
  input: CreativeDnaInput | null;
};

/** What the job needs, or null when the row or its project is gone or archived. */
export async function loadCreativeBibleJob(bibleId: string): Promise<CreativeBibleJob | null> {
  if (!uuidSchema.safeParse(bibleId).success) return null;
  const [found] = await getDb()
    .select({ row: creativeBible, projectId: project.id, ownerId: project.ownerId })
    .from(creativeBible)
    .innerJoin(project, eq(project.id, creativeBible.projectId))
    .where(and(eq(creativeBible.id, bibleId), isNull(project.archivedAt)))
    .limit(1);
  if (!found) return null;
  return {
    row: found.row,
    project: { id: found.projectId, ownerId: found.ownerId },
    input: creativeDnaInputFromStyle(found.row.styleSnapshot),
  };
}

/**
 * pending → ready with the compiled bible. Returns false (and changes nothing) when the row is no
 * longer pending (superseded by a Style change, or another run finished it).
 */
export async function completeCreativeBible(input: {
  bibleId: string;
  bible: CreativeBible;
  damiRunId: string | null;
}): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(creativeBible)
      .set({
        status: "ready",
        bible: input.bible,
        failure: null,
        finishedAt: new Date(),
        ...(input.damiRunId ? { damiRunId: input.damiRunId } : {}),
      })
      .where(and(eq(creativeBible.id, input.bibleId), eq(creativeBible.status, "pending")))
      .returning();
    if (!row) return false;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "creative_bible.ready",
      payload: { bibleId: row.id, versionNumber: row.versionNumber },
    });
    return true;
  });
}

/** pending → failed with the reason shown to the user. Returns false when the row is not pending. */
export async function failCreativeBible(input: {
  bibleId: string;
  failure: string;
  damiRunId: string | null;
}): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(creativeBible)
      .set({
        status: "failed",
        failure: input.failure,
        finishedAt: new Date(),
        ...(input.damiRunId ? { damiRunId: input.damiRunId } : {}),
      })
      .where(and(eq(creativeBible.id, input.bibleId), eq(creativeBible.status, "pending")))
      .returning();
    if (!row) return false;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "creative_bible.failed",
      payload: { bibleId: row.id, versionNumber: row.versionNumber, failure: input.failure },
    });
    return true;
  });
}
