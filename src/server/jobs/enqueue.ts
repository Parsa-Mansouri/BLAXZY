import type { JobDefinition, JobInput, JobPayload } from "./define";
import { getBackend, sendJob, stopBackend } from "./pg-boss";

export type EnqueueOptions = {
  /** Do not run before this time. */
  startAfter?: Date;
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
  return sendJob(backend, job, {
    payload: data,
    dedupeKey: job.dedupeKey?.(data),
    startAfter: options.startAfter,
  });
}

/** Close this process's queue connection (scripts and tests; the worker uses `stopWorker`). */
export async function closeJobQueue(): Promise<void> {
  await stopBackend(5_000);
}
