/**
 * Worker liveness: each worker process upserts its row in `worker_heartbeat` every
 * `WORKER_HEARTBEAT_SECONDS`; readiness calls the worker down when no row is fresher than
 * `WORKER_DOWN_AFTER_SECONDS`. Times come from Postgres (`now()`), so clock skew between hosts
 * does not matter. Rows of instances that stopped beating long ago are pruned by the live workers.
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { workerHeartbeat } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { errorMessage, logLine } from "@/server/log";

/** Rows older than this many "down after" periods are deleted (kept a while for diagnosis). */
const PRUNE_AFTER_PERIODS = 10;

export type WorkerInstance = { id: string; hostname: string; pid: number; startedAt: Date };

/** This process's identity (unique even when two containers share a hostname and pid). */
export function newWorkerInstance(): WorkerInstance {
  const host = hostname();
  return {
    id: `${host}:${process.pid}:${randomUUID().slice(0, 8)}`,
    hostname: host,
    pid: process.pid,
    startedAt: new Date(),
  };
}

/** Upserts the instance's row with `seen_at = now()`. */
export async function recordHeartbeat(instance: WorkerInstance): Promise<void> {
  await getDb()
    .insert(workerHeartbeat)
    .values({
      instanceId: instance.id,
      hostname: instance.hostname,
      pid: instance.pid,
      startedAt: instance.startedAt,
      seenAt: sql`now()`,
    })
    .onConflictDoUpdate({ target: workerHeartbeat.instanceId, set: { seenAt: sql`now()` } });
}

/** Deletes the rows of instances silent for more than `olderThanSeconds`; returns how many. */
export async function pruneHeartbeats(olderThanSeconds: number): Promise<number> {
  const rows = await getDb()
    .delete(workerHeartbeat)
    .where(sql`${workerHeartbeat.seenAt} < now() - make_interval(secs => ${olderThanSeconds})`)
    .returning({ id: workerHeartbeat.instanceId });
  return rows.length;
}

/** Deletes this instance's row (a clean shutdown: the worker is gone, not dead). */
export async function removeHeartbeat(instanceId: string): Promise<void> {
  await getDb()
    .delete(workerHeartbeat)
    .where(sql`${workerHeartbeat.instanceId} = ${instanceId}`);
}

/** True when some worker beat within the last `downAfterSeconds`. Throws when the query fails. */
export async function isWorkerAlive(downAfterSeconds: number): Promise<boolean> {
  const result = await getDb().execute<{ alive: boolean }>(
    sql`select exists (
      select 1 from ${workerHeartbeat}
      where ${workerHeartbeat.seenAt} > now() - make_interval(secs => ${downAfterSeconds})
    ) as alive`,
  );
  return result.rows[0]?.alive === true;
}

/**
 * Starts beating for this process (worker only): one beat now, then every
 * `WORKER_HEARTBEAT_SECONDS`, each also pruning long-dead instances. A failed beat is logged and
 * the next one tries again. `stop` ends the beats and removes this instance's row.
 */
export function startHeartbeat(instance: WorkerInstance = newWorkerInstance()): {
  instance: WorkerInstance;
  stop: () => Promise<void>;
} {
  const env = getEnv();
  let running: Promise<void> = Promise.resolve();
  const beat = async () => {
    try {
      await recordHeartbeat(instance);
      await pruneHeartbeats(env.WORKER_DOWN_AFTER_SECONDS * PRUNE_AFTER_PERIODS);
    } catch (err) {
      logLine("warn", "worker heartbeat failed", {
        instance: instance.id,
        error: errorMessage(err),
      });
    }
  };
  running = beat();
  const timer = setInterval(() => {
    running = running.then(beat);
  }, env.WORKER_HEARTBEAT_SECONDS * 1000);
  timer.unref();
  return {
    instance,
    stop: async () => {
      clearInterval(timer);
      await running;
      await removeHeartbeat(instance.id).catch((err: unknown) =>
        logLine("warn", "could not remove the worker heartbeat", {
          instance: instance.id,
          error: errorMessage(err),
        }),
      );
    },
  };
}
