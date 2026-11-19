/**
 * Readiness: the database, the object store bucket, the job queue and the worker heartbeat, each
 * with its own timeout, all in parallel. The database, the bucket or the queue failing makes the
 * web process unready (503); a worker that stopped beating only degrades it (200: restarting web
 * processes would not bring the worker back) and raises an alert, at most once per
 * `WORKER_DOWN_ALERT_MINUTES` across every replica.
 */
import { sql } from "drizzle-orm";
import { isDatabaseHealthy } from "@/server/db/health";
import { getDb } from "@/server/db/client";
import { opsAlert } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { checkQueue } from "@/server/jobs";
import { errorMessage, logLine } from "@/server/log";
import { pingBucket } from "@/server/storage";
import { isWorkerAlive } from "./heartbeat";

export type CheckState = "ok" | "fail";
export type WorkerState = "ok" | "down" | "unknown";

/** What the endpoint reports: names and states only, never a reason. */
export type Readiness = {
  status: "ok" | "degraded" | "unavailable";
  checks: { database: CheckState; storage: CheckState; queue: CheckState; worker: WorkerState };
};

/**
 * Runs `check` with an abort signal and a hard timeout: resolves to its value, or to `fallback`
 * when it throws or outlives `timeoutMs`. Never throws, never leaks the reason.
 */
export async function withTimeout<T>(
  check: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, timeoutMs);
  });
  const run = Promise.resolve().then(() => check(controller.signal));
  // A check that loses the race must not become an unhandled rejection.
  run.catch(() => undefined);
  try {
    return await Promise.race([run, timeout]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Raises the alert unless one with this key was raised within `minutes`, decided by a conditional
 * upsert on `ops_alert` (one winner across replicas, no in-memory state). True when this call
 * raised it.
 */
export async function raiseRateLimitedAlert(
  key: string,
  minutes: number,
  msg: string,
  fields: Record<string, unknown> = {},
): Promise<boolean> {
  const rows = await getDb()
    .insert(opsAlert)
    .values({ key, raisedAt: sql`now()` })
    .onConflictDoUpdate({
      target: opsAlert.key,
      set: { raisedAt: sql`now()` },
      setWhere: sql`${opsAlert.raisedAt} < now() - make_interval(mins => ${minutes})`,
    })
    .returning({ key: opsAlert.key });
  if (rows.length === 0) return false;
  logLine("error", msg, { alert: true, alertKey: key, ...fields });
  return true;
}

export async function checkReadiness(): Promise<Readiness> {
  const env = getEnv();
  const ms = env.HEALTH_CHECK_TIMEOUT_MS;
  const state = (ok: boolean): CheckState => (ok ? "ok" : "fail");
  const [database, storage, queue, worker] = await Promise.all([
    isDatabaseHealthy(ms),
    withTimeout((signal) => pingBucket(signal).then(() => true), ms, false),
    withTimeout(() => checkQueue().then(() => true), ms, false),
    withTimeout(
      () =>
        isWorkerAlive(env.WORKER_DOWN_AFTER_SECONDS).then((alive): WorkerState =>
          alive ? "ok" : "down",
        ),
      ms,
      "unknown" as WorkerState,
    ),
  ]);
  const checks = {
    database: state(database),
    storage: state(storage),
    queue: state(queue),
    worker,
  };
  const unavailable = !database || !storage || !queue;
  if (worker === "down") {
    try {
      await raiseRateLimitedAlert(
        "worker.down",
        env.WORKER_DOWN_ALERT_MINUTES,
        "worker down: no heartbeat",
        { downAfterSeconds: env.WORKER_DOWN_AFTER_SECONDS },
      );
    } catch (err) {
      logLine("warn", "could not raise the worker-down alert", { error: errorMessage(err) });
    }
  }
  return {
    status: unavailable ? "unavailable" : worker === "ok" ? "ok" : "degraded",
    checks,
  };
}
