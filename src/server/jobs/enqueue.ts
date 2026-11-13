import type { DbTx } from "@/server/db/client";
import type { JobDefinition, JobInput, JobPayload } from "./define";
import { ALL_JOBS } from "./definitions";
import { ensureQueues, getBackend, sendJob, stopBackend } from "./pg-boss";

export type EnqueueOptions = {
  /** Do not run before this time. */
  startAfter?: Date;
  /**
   * Send the job on this open transaction (the caller's `db.transaction(async (tx) => ...)`).
   * The job exists only if the transaction commits, and is delivered only after it does, so a
   * state change and its follow-up job are written together or not at all. Required whenever a
   * job is enqueued because of a row written in the same transaction (see the jobs README).
   */
  tx?: DbTx;
};

export class InvalidJobPayloadError extends Error {
  constructor(
    readonly job: string,
    readonly issues: string[],
  ) {
    super(`Invalid payload for job "${job}": ${issues.join("; ")}`);
    this.name = "InvalidJobPayloadError";
  }
}

/** Validate a payload against the job's schema (throws `InvalidJobPayloadError`). */
export function parsePayload<J extends JobDefinition>(job: J, payload: unknown): JobPayload<J> {
  const result = job.payload.safeParse(payload);
  if (!result.success) {
    throw new InvalidJobPayloadError(
      job.name,
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  return result.data as JobPayload<J>;
}

/**
 * Validate and enqueue a job. Works from web processes (send only) and from job handlers.
 * Resolves to the job id, or `null` when the job type has a dedupe key and a job with the same key
 * is already queued or running.
 *
 * With `tx`, the job is written on that transaction (see `EnqueueOptions.tx`). The queues of every
 * registered job type are created once per process before the first send, never inside `tx`.
 */
export async function enqueue<J extends JobDefinition>(
  job: J,
  payload: JobInput<J>,
  options: EnqueueOptions = {},
): Promise<string | null> {
  const data = parsePayload(job, payload);
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new InvalidJobPayloadError(job.name, ["payload must be an object"]);
  }
  const backend = await getBackend("web");
  await ensureQueues(backend, ALL_JOBS);
  return sendJob(backend, job, {
    payload: data,
    dedupeKey: job.dedupeKey?.(data),
    startAfter: options.startAfter,
    tx: options.tx,
  });
}

/** Close this process's queue connection (scripts and tests; the worker uses `stopWorker`). */
export async function closeJobQueue(): Promise<void> {
  await stopBackend(5_000);
}
