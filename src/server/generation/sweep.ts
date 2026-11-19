/**
 * The `generation.sweep` job's work (worker only), a safety net the normal path never needs:
 *
 * 1. Stuck generations are failed with a user-readable error and refunded: `running` ones that
 *    started before `GENERATION_STUCK_AFTER_MINUTES`, and `queued` ones that never started and were
 *    created before `QUEUED_STUCK_AFTER_MINUTES` (much longer: they may be waiting behind the
 *    per-user limit, which is not a failure).
 * 2. Queued generations waiting longer than `REQUEUE_QUEUED_AFTER_MS` get their `generation.run`
 *    job sent again (a no-op while one is queued: same dedupe key), in case it was lost.
 * 3. Finished generations whose completion hooks never ran to the end (`notified_at` is null, and
 *    they finished more than `NOTIFY_GRACE_MS` ago) get the hooks called again. This covers a hook
 *    that kept failing past the run's retries, a worker that died between the final commit and the
 *    hooks, and a sweep that died after failing a generation.
 *
 * Idempotent and safe beside running jobs: a generation is failed with the same conditional
 * update as a failed run (`queued`/`running` only), so a run that finishes at the same time either
 * wins (and the sweep skips it) or loses (and finds it failed). Hooks are idempotent.
 */
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { generation } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { errorMessage, logLine } from "@/server/jobs/log";
import { notify } from "./run";
import { enqueueGeneration, failGeneration } from "./service";

export const STUCK_FAILURE =
  "This generation took too long and was stopped. Your credits were returned; try again.";

/** A queued generation that never started is failed after this long (it may be waiting its turn). */
export const QUEUED_STUCK_AFTER_MINUTES = 12 * 60;
/** A queued generation waiting longer than this gets its run job sent again. */
export const REQUEUE_QUEUED_AFTER_MS = 30 * 60_000;
/** Finished generations are re-notified only after this, so the run's own call goes first. */
export const NOTIFY_GRACE_MS = 2 * 60_000;

const BATCH_SIZE = 100;
/** Upper bound per sweep; the next sweep continues. */
const MAX_BATCHES = 20;
/** Upper bound of generations re-notified or re-queued per sweep. */
const MAX_FOLLOW_UPS = 200;

export type SweepResult = {
  /** Failed and refunded by this sweep. */
  failed: string[];
  /** Finished earlier; their hooks were called again and returned. */
  renotified: string[];
  /** Queued for a long time; their run job was sent again. */
  requeued: string[];
};

export async function sweepStuckGenerations(
  options: {
    /** Default `GENERATION_STUCK_AFTER_MINUTES`. */
    stuckAfterMinutes?: number;
    /** Default `QUEUED_STUCK_AFTER_MINUTES`. */
    queuedStuckAfterMinutes?: number;
    now?: Date;
    /** Only this user's generations (tests). */
    userId?: string;
  } = {},
): Promise<SweepResult> {
  const minutes = options.stuckAfterMinutes ?? getEnv().GENERATION_STUCK_AFTER_MINUTES;
  const queuedMinutes = options.queuedStuckAfterMinutes ?? QUEUED_STUCK_AFTER_MINUTES;
  const now = (options.now ?? new Date()).getTime();
  const cutoff = new Date(now - minutes * 60_000);
  const queuedCutoff = new Date(now - queuedMinutes * 60_000);
  const ofUser = options.userId ? eq(generation.userId, options.userId) : undefined;
  const failed: string[] = [];
  const seen = new Set<string>();

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await getDb()
      .select({ id: generation.id })
      .from(generation)
      .where(
        and(
          or(
            and(eq(generation.status, "running"), lt(generation.startedAt, cutoff)),
            // A running row without a start time (not written by the engine) counts from creation.
            and(
              eq(generation.status, "running"),
              isNull(generation.startedAt),
              lt(generation.createdAt, cutoff),
            ),
            and(
              eq(generation.status, "queued"),
              lt(sql`coalesce(${generation.startedAt}, ${generation.createdAt})`, queuedCutoff),
            ),
          ),
          ofUser,
        ),
      )
      .orderBy(asc(generation.createdAt))
      .limit(BATCH_SIZE);
    const fresh = rows.filter((r) => !seen.has(r.id));
    if (fresh.length === 0) break;
    for (const { id } of fresh) {
      seen.add(id);
      if (!(await failGeneration(id, STUCK_FAILURE))) continue; // finished meanwhile
      failed.push(id);
      // An alert: the normal path never leaves a generation stuck, so each one is worth a look.
      logLine("warn", "stuck generation failed and refunded", {
        generationId: id,
        stuckAfterMinutes: minutes,
        alert: true,
      });
      // Its hooks: right away; if one throws, the re-notify pass of a later sweep retries.
      await notifyLogged(id);
    }
    if (rows.length < BATCH_SIZE) break;
  }

  const requeued = await requeueWaiting(now, ofUser);
  const renotified = await renotifyFinished(now, ofUser, new Set(failed));
  return { failed, renotified, requeued };
}

/** Sends the run job of long-waiting queued generations again (deduplicated per generation). */
async function requeueWaiting(now: number, ofUser: SQL | undefined) {
  const rows = await getDb()
    .select({ id: generation.id })
    .from(generation)
    .where(
      and(
        eq(generation.status, "queued"),
        lt(generation.createdAt, new Date(now - REQUEUE_QUEUED_AFTER_MS)),
        ofUser,
      ),
    )
    .orderBy(asc(generation.createdAt))
    .limit(MAX_FOLLOW_UPS);
  const requeued: string[] = [];
  for (const { id } of rows) {
    try {
      await enqueueGeneration(id);
      requeued.push(id);
    } catch (err) {
      logLine("error", "could not requeue a waiting generation", {
        generationId: id,
        error: errorMessage(err),
      });
    }
  }
  return requeued;
}

/** Calls the hooks again for finished generations whose hooks never returned (bounded). */
async function renotifyFinished(now: number, ofUser: SQL | undefined, skip: ReadonlySet<string>) {
  const rows = await getDb()
    .select({ id: generation.id })
    .from(generation)
    .where(
      and(
        isNull(generation.notifiedAt),
        isNotNull(generation.finishedAt),
        lt(generation.finishedAt, new Date(now - NOTIFY_GRACE_MS)),
        inArray(generation.status, ["succeeded", "failed", "cancelled"]),
        ofUser,
      ),
    )
    .orderBy(asc(generation.finishedAt))
    .limit(MAX_FOLLOW_UPS);
  const renotified: string[] = [];
  for (const { id } of rows) {
    if (skip.has(id)) continue;
    if (await notifyLogged(id)) {
      renotified.push(id);
      logLine("warn", "completion hooks called again for a finished generation", {
        generationId: id,
      });
    }
  }
  return renotified;
}

/** Calls the hooks of a finished generation; false (logged) when one throws. */
async function notifyLogged(generationId: string): Promise<boolean> {
  try {
    const [row] = await getDb()
      .select()
      .from(generation)
      .where(eq(generation.id, generationId))
      .limit(1);
    if (!row) return false;
    await notify(row);
    return true;
  } catch (err) {
    logLine("error", "completion hook failed; the next sweep calls it again", {
      generationId,
      error: errorMessage(err),
    });
    return false;
  }
}
