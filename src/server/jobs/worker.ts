import type { JobDefinition, JobPayload } from "./define";
import { InvalidJobPayloadError, parsePayload } from "./enqueue";
import { errorMessage, logLine } from "./log";
import {
  getBackend,
  releaseAttempt,
  scheduleJob,
  stopBackend,
  stopFetching,
  workQueue,
  type HandleOutcome,
  type QueueBackend,
} from "./pg-boss";

export type JobContext = {
  jobId: string;
  /** 1 for the first attempt, 2 for the first retry, ... */
  attempt: number;
  /**
   * Aborted when the attempt expires or the worker shuts down; pass it to long I/O. A shutdown
   * aborts with a `JobShutdownError` reason (see `isShutdownAbort`): the job is delivered again
   * without using up an attempt, so a handler must not record a failure for it.
   */
  signal: AbortSignal;
  /**
   * This job's retry limit when the queue delivered it (the job type's, plus any attempt given
   * back at a shutdown). Absent when a test calls a handler directly.
   */
  retryLimit?: number;
};

/** The reason of an attempt aborted because the worker is shutting down. */
export class JobShutdownError extends Error {
  constructor() {
    super("The worker is shutting down; the job will run again.");
    this.name = "JobShutdownError";
  }
}

/** The attempt was aborted because the worker is shutting down (not because it expired). */
export function isShutdownAbort(signal: AbortSignal): boolean {
  return signal.aborted && signal.reason instanceof JobShutdownError;
}

/** The attempt is the job's last (the queue will not retry it). */
export function isLastAttempt(job: JobDefinition, context: JobContext): boolean {
  return context.attempt > (context.retryLimit ?? job.options.retryLimit);
}

/** The payload a handler received does not match its job type: retrying cannot fix it. */
class ReceivedPayloadError extends InvalidJobPayloadError {}

/** A handler bound to its job type (type-erased so handlers of any type fit in one list). */
export type JobHandler = {
  readonly job: JobDefinition;
  /**
   * Validates the payload, then runs the handler. An invalid payload rejects the job for good;
   * any error the handler throws (an `InvalidJobPayloadError` from a nested enqueue included) is
   * an ordinary failure that is retried.
   */
  readonly run: (data: unknown, context: JobContext) => Promise<void>;
};

/**
 * Bind a handler to a job type. Handlers must be idempotent: a job can run more than once (a
 * retry after a crash, an expired attempt, a re-enqueue). See the jobs README for the pattern.
 * Throw to fail the attempt; it is retried per the job type's options.
 */
export function defineHandler<J extends JobDefinition>(
  job: J,
  handler: (payload: JobPayload<J>, context: JobContext) => Promise<void>,
): JobHandler {
  return {
    job,
    run: async (data, context) => {
      let payload: JobPayload<J>;
      try {
        payload = parsePayload(job, data);
      } catch (err) {
        if (err instanceof InvalidJobPayloadError) {
          throw new ReceivedPayloadError(err.job, err.issues);
        }
        throw err;
      }
      await handler(payload, context);
    },
  };
}

/** A job type sent on a recurring schedule (cron, UTC), with a fixed payload. */
export type JobSchedule = { job: JobDefinition; cron: string; payload: object };

export type WorkerOptions = {
  handlers: JobHandler[];
  /** Recurring jobs. Every worker registers them; there is one schedule per job type. */
  schedules?: JobSchedule[];
  concurrency: {
    /** Jobs of one type this process runs at once. */
    default: number;
    /** Overrides by job name; 0 leaves the job type to other workers. */
    perJob?: Record<string, number>;
  };
  pollingIntervalSeconds: number;
};

/*
 * Worker-process state (configuration of this process, not request state): the queues it consumes,
 * the handlers running now, and the shutdown signal every handler's signal also listens to.
 */
const subscribed = new Set<string>();
const inFlight = new Set<Promise<unknown>>();
let shutdown = new AbortController();
let workerBackend: QueueBackend | undefined;

type Received = {
  jobId: string;
  attempt: number;
  retryLimit: number;
  signal: AbortSignal;
  data: unknown;
};

async function runLogged(handler: JobHandler, received: Received): Promise<HandleOutcome> {
  const { job } = handler;
  const started = Date.now();
  const base = { job: job.name, id: received.jobId, attempt: received.attempt };
  const signal = AbortSignal.any([received.signal, shutdown.signal]);
  try {
    await handler.run(received.data, {
      jobId: received.jobId,
      attempt: received.attempt,
      retryLimit: received.retryLimit,
      signal,
    });
    logLine("info", "job", { ...base, ms: Date.now() - started, outcome: "completed" });
    return { outcome: "completed" };
  } catch (err) {
    const ms = Date.now() - started;
    if (err instanceof ReceivedPayloadError) {
      // Retrying cannot fix a payload; fail it for good.
      logLine("error", "job", { ...base, ms, outcome: "rejected", error: err.message });
      return { outcome: "rejected", error: err.message };
    }
    if (isShutdownAbort(signal) && workerBackend) {
      // Not the job's fault: give the attempt back so the queue delivers it again.
      try {
        await releaseAttempt(workerBackend, job, received.jobId, received.attempt);
      } catch (releaseError) {
        logLine("error", "could not give back an interrupted attempt", {
          ...base,
          error: errorMessage(releaseError),
        });
      }
      logLine("warn", "job", { ...base, ms, outcome: "interrupted", error: errorMessage(err) });
      throw err;
    }
    const retrying = received.attempt <= received.retryLimit;
    logLine("error", "job", { ...base, ms, outcome: "failed", retrying, error: errorMessage(err) });
    throw err;
  }
}

/** Runs `run` and tracks it until it settles, so `stopWorker` can wait for it. */
function tracked<T>(run: () => Promise<T>): Promise<T> {
  const promise = run();
  const entry = promise.catch(() => undefined);
  inFlight.add(entry);
  void entry.finally(() => inFlight.delete(entry));
  return promise;
}

/**
 * Subscribe the handlers in this process. Each job type gets its own concurrency; the total
 * across the fleet is the sum over worker processes.
 */
export async function startWorker(options: WorkerOptions): Promise<void> {
  const names = new Set<string>();
  for (const { job } of options.handlers) {
    if (names.has(job.name)) throw new Error(`Two handlers for job "${job.name}"`);
    names.add(job.name);
  }
  const perJob = options.concurrency.perJob ?? {};
  for (const name of Object.keys(perJob)) {
    if (!names.has(name))
      logLine("warn", "concurrency set for a job without handler", { job: name });
  }

  if (shutdown.signal.aborted) shutdown = new AbortController();
  const backend = await getBackend("worker");
  workerBackend = backend;
  for (const handler of options.handlers) {
    const concurrency = perJob[handler.job.name] ?? options.concurrency.default;
    if (concurrency === 0) {
      logLine("info", "job type disabled on this worker", { job: handler.job.name });
      continue;
    }
    await workQueue(
      backend,
      handler.job,
      { concurrency, pollingIntervalSeconds: options.pollingIntervalSeconds },
      (received) =>
        tracked(() =>
          runLogged(handler, {
            jobId: received.id,
            attempt: received.attempt,
            retryLimit: received.retryLimit,
            signal: received.signal,
            data: received.data,
          }),
        ),
    );
    subscribed.add(handler.job.name);
    logLine("info", "job type subscribed", { job: handler.job.name, concurrency });
  }
  for (const schedule of options.schedules ?? []) {
    const payload = parsePayload(schedule.job, schedule.payload);
    if (typeof payload !== "object" || payload === null) {
      throw new InvalidJobPayloadError(schedule.job.name, ["payload must be an object"]);
    }
    await scheduleJob(
      backend,
      schedule.job,
      schedule.cron,
      payload,
      schedule.job.dedupeKey?.(payload),
    );
    logLine("info", "job type scheduled", { job: schedule.job.name, cron: schedule.cron });
  }
}

/** Resolves once every tracked handler has settled, or after `ms` (true when all settled). */
async function settled(ms: number): Promise<boolean> {
  if (inFlight.size === 0) return true;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, ms));
  });
  const all = (async () => {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    return true as const;
  })();
  try {
    return await Promise.race([all, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Longest wait for handlers to unwind after the shutdown abort. */
const MAX_UNWIND_MS = 10_000;

/**
 * Stops the worker within `timeoutMs`: stop fetching; let running handlers finish; abort the ones
 * still running with a shutdown reason (`isShutdownAbort`), which gives their attempt back so the
 * queue delivers the job again, and wait for them to unwind; then close the queue connection.
 * Resolves only once no handler is running any more (or the time is up), so the caller can close
 * the database afterwards.
 */
export async function stopWorker(timeoutMs: number): Promise<void> {
  const unwindMs = Math.min(MAX_UNWIND_MS, Math.floor(timeoutMs / 3));
  const backend = workerBackend;
  if (backend) await stopFetching(backend, subscribed);
  if (!(await settled(timeoutMs - unwindMs))) {
    logLine("warn", "aborting running jobs for shutdown", { running: inFlight.size });
    shutdown.abort(new JobShutdownError());
    if (!(await settled(unwindMs))) {
      logLine("error", "jobs still running at shutdown", { running: inFlight.size });
    }
  }
  subscribed.clear();
  workerBackend = undefined;
  // Anything still running now is failed by pg-boss and retried by another worker.
  await stopBackend(1_000);
}
