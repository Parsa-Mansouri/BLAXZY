/**
 * The only file that imports pg-boss. Everything else talks to the queue through the functions
 * below, so the backend can be swapped (for example for BullMQ) without touching callers.
 */
import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss, type JobResult, type SendOptions } from "pg-boss";
import type { DbTx } from "@/server/db/client";
import { getEnv } from "@/server/env";
import type { JobDefinition, JobOptions } from "./define";
import { errorMessage, logLine } from "./log";

/** `web` only sends; `worker` also runs handlers and queue maintenance. */
export type QueueRole = "web" | "worker";

export type BackendConfig = {
  role: QueueRole;
  connectionString: string;
  schema: string;
  poolMax: number;
};

export type QueueBackend = {
  readonly role: QueueRole;
  readonly schema: string;
  readonly boss: PgBoss;
  readonly queues: Map<string, Promise<void>>;
  /** Settles once every job type of the registry has its queue (see `ensureQueues`). */
  registry?: Promise<void>;
};

/** start() attempts (1s, 2s, 4s, ... apart), so a process booting before Postgres is up waits. */
const START_ATTEMPTS = 6;

/**
 * Create and start a backend. Every process (web or worker) may install or migrate the pg-boss
 * schema: pg-boss runs the install and each migration in one transaction behind a Postgres
 * advisory lock, and a process that loses the race treats "already exists" as success. So any
 * number of replicas can start at once against a fresh or an older schema.
 */
export async function startBackend(config: BackendConfig): Promise<QueueBackend> {
  const boss = new PgBoss({
    connectionString: config.connectionString,
    schema: config.schema,
    max: config.poolMax,
    application_name: `blaxzy-${config.role}`,
    instanceName: `blaxzy-${config.role}`,
    migrate: true,
    // Maintenance (expiring stuck jobs, retention) is coordinated by pg-boss across instances;
    // only workers take part, web replicas just send.
    supervise: config.role === "worker",
    // Cron schedules (`scheduleJob`) are evaluated by workers only; pg-boss coordinates the
    // instances so each occurrence is sent once.
    schedule: config.role === "worker",
  });
  boss.on("error", (err) => logLine("error", "queue error", { error: errorMessage(err) }));
  boss.on("warning", (warning) =>
    logLine("warn", "queue warning", { warning: warning.message, data: warning.data }),
  );
  await boss.start({ attempts: START_ATTEMPTS });
  return { role: config.role, schema: config.schema, boss, queues: new Map() };
}

let current: { role: QueueRole; backend: Promise<QueueBackend> } | undefined;

/**
 * Lazily started per-process backend. The first caller decides the role: the worker calls this
 * with `worker` before anything else; web processes get `web` on their first enqueue.
 */
export function getBackend(role: QueueRole): Promise<QueueBackend> {
  if (current) {
    if (current.role !== role && role === "worker") {
      throw new Error("The job queue was already started as a web (send-only) backend");
    }
    return current.backend;
  }
  const env = getEnv();
  const entry = {
    role,
    backend: startBackend({
      role,
      connectionString: env.DATABASE_URL,
      schema: env.JOBS_SCHEMA,
      poolMax: role === "worker" ? env.JOBS_WORKER_POOL_MAX : env.JOBS_WEB_POOL_MAX,
    }),
  };
  current = entry;
  // A failed start is not cached, so the next call tries again.
  entry.backend.catch(() => {
    if (current === entry) current = undefined;
  });
  return entry.backend;
}

/** Stop the per-process backend, waiting up to `timeoutMs` for running handlers to finish. */
export async function stopBackend(timeoutMs: number): Promise<void> {
  const entry = current;
  current = undefined;
  if (!entry) return;
  const backend = await entry.backend.catch(() => undefined);
  await backend?.boss.stop({ graceful: true, timeout: timeoutMs, close: true });
}

function queueOptions(options: JobOptions) {
  return {
    retryLimit: options.retryLimit,
    retryDelay: options.retryDelaySeconds,
    retryBackoff: options.retryBackoff,
    expireInSeconds: options.expireInSeconds,
    // pg-boss rejects the key (even when undefined) unless backoff is on.
    ...(options.retryBackoff && options.retryDelayMaxSeconds !== undefined
      ? { retryDelayMax: options.retryDelayMaxSeconds }
      : {}),
  };
}

type Policy = "standard" | "exclusive" | "stately";

function policyOf(job: JobDefinition): Policy {
  return !job.dedupeKey ? "standard" : job.allowFollowUp ? "stately" : "exclusive";
}

/**
 * A queue created before its job type had a dedupe key has the `standard` policy. pg-boss copies
 * the queue's policy onto every job at insert and its dedupe indexes filter on that per-job copy,
 * and an `exclusive` queue is fetched exactly like a `standard` one. So switching the queue row
 * from `standard` to `exclusive` is safe while jobs are in flight: jobs already queued keep
 * `standard` (they are not deduplicated), every job sent afterwards is. pg-boss's `updateQueue`
 * refuses any policy change, hence the direct update (idempotent: conditional on the old policy).
 * Every other change still needs a new queue (see `ensureQueue`).
 */
async function upgradeToExclusive(backend: QueueBackend, name: string): Promise<void> {
  await backend.boss
    .getDb()
    .executeSql(
      `UPDATE ${backend.schema}.queue SET policy = 'exclusive', updated_on = now() ` +
        `WHERE name = $1 AND policy = 'standard'`,
      [name],
    );
  logLine("warn", "queue policy upgraded", { queue: name, from: "standard", to: "exclusive" });
}

/**
 * Create the job type's queue once per process (idempotent across processes: the insert is
 * `ON CONFLICT DO NOTHING` under an advisory lock). A job type with a dedupe key uses the
 * `exclusive` policy: one queued-or-active job per key; with `allowFollowUp` the `stately` policy:
 * one queued and one active job per key, and a queued one is not fetched while another is active.
 * An existing `standard` queue whose job type gained a dedupe key is upgraded in place.
 */
export function ensureQueue(backend: QueueBackend, job: JobDefinition): Promise<void> {
  let pending = backend.queues.get(job.name);
  if (!pending) {
    pending = (async () => {
      const policy = policyOf(job);
      await backend.boss.createQueue(job.name, { policy, ...queueOptions(job.options) });
      let queue = await backend.boss.getQueue(job.name);
      if (queue?.policy === "standard" && policy === "exclusive") {
        await upgradeToExclusive(backend, job.name);
        queue = await backend.boss.getQueue(job.name);
      }
      if (queue?.policy !== policy) {
        throw new Error(
          `Queue "${job.name}" exists with policy "${queue?.policy}" but its definition needs ` +
            `"${policy}"; recreate the queue (dedupeKey or allowFollowUp changed)`,
        );
      }
    })();
    backend.queues.set(job.name, pending);
    pending.catch(() => backend.queues.delete(job.name));
  }
  return pending;
}

/**
 * Makes sure every job type of the registry has its queue, once per backend, so that a send inside
 * a caller's transaction never has to create one. A failure is not cached: the queue of the job
 * being sent is ensured again by `ensureQueue`, which reports it.
 */
export async function ensureQueues(
  backend: QueueBackend,
  registry: readonly JobDefinition[],
): Promise<void> {
  backend.registry ??= Promise.allSettled(registry.map((job) => ensureQueue(backend, job))).then(
    () => undefined,
  );
  await backend.registry;
}

export type SendRequest = {
  payload: object;
  dedupeKey?: string;
  startAfter?: Date;
  /** Send on this open transaction: the job exists only if it commits. */
  tx?: DbTx;
};

/** Returns the job id, or null when a job with the same dedupe key is already in flight. */
export async function sendJob(
  backend: QueueBackend,
  job: JobDefinition,
  request: SendRequest,
): Promise<string | null> {
  await ensureQueue(backend, job);
  const options: SendOptions = { ...queueOptions(job.options) };
  if (request.dedupeKey !== undefined) options.singletonKey = request.dedupeKey;
  if (request.startAfter) options.startAfter = request.startAfter;
  // pg-boss's drizzle adapter: the insert runs on the transaction's connection, so the job
  // exists only if (and once) that transaction commits.
  if (request.tx) options.db = fromDrizzle(request.tx, sql);
  return backend.boss.send(job.name, request.payload, options);
}

/**
 * Creates or updates the recurring schedule of a job type (a cron expression, UTC). Stored in the
 * queue's tables keyed by the job name, so every worker may call this at startup: there is still
 * exactly one schedule, and pg-boss sends each occurrence once whichever worker evaluates it.
 */
export async function scheduleJob(
  backend: QueueBackend,
  job: JobDefinition,
  cron: string,
  payload: object,
  dedupeKey?: string,
): Promise<void> {
  await ensureQueue(backend, job);
  await backend.boss.schedule(job.name, cron, payload, {
    ...queueOptions(job.options),
    ...(dedupeKey !== undefined ? { singletonKey: dedupeKey } : {}),
    tz: "UTC",
  });
}

/**
 * Gives an active attempt back without using it up: the job is allowed one more attempt, so the
 * failure that follows (the worker shutting down mid-attempt) is retried even on the last
 * attempt. Fenced to the fetched attempt (`retry_count`); a no-op when the job has moved on.
 */
export async function releaseAttempt(
  backend: QueueBackend,
  job: JobDefinition,
  id: string,
  attempt: number,
): Promise<void> {
  await backend.boss
    .getDb()
    .executeSql(
      `UPDATE ${backend.schema}.job SET retry_limit = retry_limit + 1 ` +
        `WHERE name = $1 AND id = $2 AND retry_count = $3 AND state = 'active'`,
      [job.name, id, attempt - 1],
    );
}

export type ReceivedJob = {
  id: string;
  data: unknown;
  /** 1 for the first attempt, 2 for the first retry, ... */
  attempt: number;
  /** This job's retry limit: the job type's, plus any attempt given back at a shutdown. */
  retryLimit: number;
  /** Aborted when the attempt expires or the worker stops without finishing it. */
  signal: AbortSignal;
};

/**
 * - `completed`: done.
 * - `rejected`: can never succeed (for example an invalid payload); failed without retries.
 * A thrown error fails the attempt and pg-boss retries it per the job type's options.
 */
export type HandleOutcome = { outcome: "completed" } | { outcome: "rejected"; error: string };

export async function workQueue(
  backend: QueueBackend,
  job: JobDefinition,
  options: { concurrency: number; pollingIntervalSeconds: number },
  handle: (received: ReceivedJob) => Promise<HandleOutcome>,
): Promise<void> {
  await ensureQueue(backend, job);
  await backend.boss.work(
    job.name,
    {
      batchSize: 1,
      localConcurrency: options.concurrency,
      pollingIntervalSeconds: options.pollingIntervalSeconds,
      perJobResults: true,
      includeMetadata: true,
    },
    async (jobs): Promise<JobResult[]> => {
      const results: JobResult[] = [];
      for (const received of jobs) {
        const result = await handle({
          id: received.id,
          data: received.data,
          attempt: received.retryCount + 1,
          retryLimit: received.retryLimit,
          signal: received.signal,
        });
        results.push(
          result.outcome === "completed"
            ? { id: received.id, status: "completed" }
            : { id: received.id, status: "deadletter", output: { error: result.error } },
        );
      }
      return results;
    },
  );
}

/** Stops fetching new jobs from these queues; running handlers go on (see `stopWorker`). */
export async function stopFetching(backend: QueueBackend, names: Iterable<string>): Promise<void> {
  await Promise.allSettled([...names].map((name) => backend.boss.offWork(name, { wait: false })));
}
