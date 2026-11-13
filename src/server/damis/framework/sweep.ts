import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";
import { damiRun } from "@/server/db/schema";
import type { DamiRunStatus } from "@/server/db/schema";

/**
 * A `running` row older than this is treated as an orphan (its process died). One Claude call is
 * capped at 30 minutes by the client timeout, and the normal worst case is one slow call plus the
 * one corrective call (60 minutes) with backoff of at most 30 s between retries. 90 minutes sits
 * above that with margin. Only a pathological run (several consecutive 30-minute timeouts, up to
 * `DAMI_MAX_RETRIES` + 2 calls) can outlive it; if it does finish later, `finish()` still
 * overwrites the swept row with the real result.
 */
export const DEFAULT_STUCK_AFTER_MINUTES = 90;

const SWEEP_BATCH = 200;
const MAX_BATCHES = 50;

/**
 * Marks `running` dami runs that started more than `stuckAfterMinutes` ago as `aborted` (their
 * process died, so nothing will ever finish them), in batches of 200. The update is conditional on
 * `status = 'running'`, so a run that finishes concurrently is never overwritten. Safe to call from
 * any number of workers at once. Query path: `dami_run.status` (`dami_run_status_idx`); a composite
 * index on `(status, started_at)` would serve it best once the table is large.
 */
export async function sweepStuckDamiRuns(
  options: { stuckAfterMinutes?: number; now?: Date; db?: Db } = {},
): Promise<{ swept: number }> {
  const minutes = options.stuckAfterMinutes ?? DEFAULT_STUCK_AFTER_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`stuckAfterMinutes must be positive, got ${minutes}`);
  }
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - minutes * 60_000);
  const db = options.db ?? getDb();
  const running = "running" satisfies DamiRunStatus;
  let swept = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await db
      .select({ id: damiRun.id })
      .from(damiRun)
      .where(and(eq(damiRun.status, running), lt(damiRun.startedAt, cutoff)))
      .limit(SWEEP_BATCH);
    if (rows.length === 0) break;
    const updated = await db
      .update(damiRun)
      .set({
        status: "aborted" as string as DamiRunStatus,
        error: `Swept: still running after ${minutes} minutes, its process most likely died.`,
        finishedAt: now,
      })
      .where(
        and(
          inArray(
            damiRun.id,
            rows.map((r) => r.id),
          ),
          eq(damiRun.status, running),
        ),
      )
      .returning({ id: damiRun.id });
    swept += updated.length;
    if (rows.length < SWEEP_BATCH) break;
  }
  return { swept };
}
