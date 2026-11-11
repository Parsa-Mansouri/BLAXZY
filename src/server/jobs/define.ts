import type { z } from "zod";

/** Retry and run-time defaults of a job type. Applied to every job of that type. */
export type JobOptions = {
  /** Retries after the first attempt before the job is marked failed. */
  retryLimit: number;
  /** Delay before a retry, in seconds (the base delay when `retryBackoff` is on). */
  retryDelaySeconds: number;
  /** Exponential backoff with jitter, starting at `retryDelaySeconds`. */
  retryBackoff: boolean;
  /** Upper bound of the backoff delay, in seconds. */
  retryDelayMaxSeconds?: number;
  /** Longest one attempt may run before it is aborted and retried, in seconds. */
  expireInSeconds: number;
};

export const DEFAULT_JOB_OPTIONS: JobOptions = {
  retryLimit: 3,
  retryDelaySeconds: 5,
  retryBackoff: true,
  retryDelayMaxSeconds: 300,
  expireInSeconds: 15 * 60,
};

/**
 * A job type: its queue name, payload schema and defaults. Defining a job imports no handler code,
 * so web processes can enqueue it cheaply; the handler is bound in the worker (`defineHandler`).
 */
export type JobDefinition<TSchema extends z.ZodType = z.ZodType> = {
  readonly name: string;
  readonly payload: TSchema;
  readonly options: JobOptions;
  /**
   * Dedupe key for a payload. When set, at most one job per key can be queued, retrying or running
   * at a time; enqueueing another one while it is in flight is a no-op. Once the job has finished
   * the same key can be enqueued again, so handlers must still be idempotent.
   *
   * Changing whether a job type has a dedupe key changes its queue policy, which needs the queue
   * to be recreated (pg-boss cannot change the policy of an existing queue).
   */
  readonly dedupeKey?: (payload: z.output<TSchema>) => string;
  /**
   * With a dedupe key: also allow one queued job beside the running one, so a running handler can
   * schedule its own follow-up (for example "try again in 20 s") with the same key. Jobs with the
   * same key still never run at the same time. Changing it also needs the queue to be recreated.
   */
  readonly allowFollowUp?: boolean;
};

export type JobPayload<J extends JobDefinition> = z.output<J["payload"]>;
export type JobInput<J extends JobDefinition> = z.input<J["payload"]>;

const NAME_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/;

/**
 * Define a job type once, at module top level (see `definitions.ts`). Names are dot-separated
 * lower-case segments (`script.generate`); they are the queue names.
 */
export function defineJob<TSchema extends z.ZodType>(definition: {
  name: string;
  payload: TSchema;
  options?: Partial<JobOptions>;
  dedupeKey?: (payload: z.output<TSchema>) => string;
  allowFollowUp?: boolean;
}): JobDefinition<TSchema> {
  if (definition.allowFollowUp && !definition.dedupeKey) {
    throw new Error(`Job "${definition.name}": allowFollowUp needs a dedupeKey`);
  }
  if (!NAME_PATTERN.test(definition.name)) {
    throw new Error(`Invalid job name "${definition.name}" (use lower-case dot-separated words)`);
  }
  return Object.freeze({
    name: definition.name,
    payload: definition.payload,
    options: { ...DEFAULT_JOB_OPTIONS, ...definition.options },
    dedupeKey: definition.dedupeKey,
    allowFollowUp: definition.allowFollowUp ?? false,
  });
}
