import type { JobDefinition, JobPayload } from "./define";
import { InvalidJobPayloadError, parsePayload } from "./enqueue";
import { errorMessage, logLine } from "./log";
import { getBackend, scheduleJob, stopBackend, workQueue, type HandleOutcome } from "./pg-boss";

export type JobContext = {
  jobId: string;
  /** 1 for the first attempt, 2 for the first retry, ... */
  attempt: number;
  /** Aborted when the attempt expires or the worker shuts down; pass it to long I/O. */
  signal: AbortSignal;
};

/** A handler bound to its job type (type-erased so handlers of any type fit in one list). */
export type JobHandler = {
  readonly job: JobDefinition;
  /** Validates the payload (throws `InvalidJobPayloadError`), then runs the handler. */
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
  return { job, run: (data, context) => handler(parsePayload(job, data), context) };
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

async function runLogged(handler: JobHandler, received: JobContext & { data: unknown }) {
  const { job } = handler;
  const started = Date.now();
  const base = { job: job.name, id: received.jobId, attempt: received.attempt };
  try {
    await handler.run(received.data, {
      jobId: received.jobId,
      attempt: received.attempt,
      signal: received.signal,
    });
    logLine("info", "job", { ...base, ms: Date.now() - started, outcome: "completed" });
    return { outcome: "completed" } satisfies HandleOutcome;
  } catch (err) {
    const ms = Date.now() - started;
    if (err instanceof InvalidJobPayloadError) {
      // Retrying cannot fix a payload; fail it for good.
      logLine("error", "job", { ...base, ms, outcome: "rejected", error: err.message });
      return { outcome: "rejected", error: err.message } satisfies HandleOutcome;
    }
    const retrying = received.attempt <= job.options.retryLimit;
    logLine("error", "job", { ...base, ms, outcome: "failed", retrying, error: errorMessage(err) });
    throw err;
  }
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

  const backend = await getBackend("worker");
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
        runLogged(handler, {
          jobId: received.id,
          attempt: received.attempt,
          signal: received.signal,
          data: received.data,
        }),
    );
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

/**
 * Stop fetching, wait up to `timeoutMs` for running jobs, then fail the rest (they are retried by
 * another worker) and close the queue connection.
 */
export async function stopWorker(timeoutMs: number): Promise<void> {
  await stopBackend(timeoutMs);
}
