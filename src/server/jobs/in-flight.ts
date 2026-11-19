import type { JobDefinition } from "./define";
import { findJobRefs, getBackend, pingQueue } from "./pg-boss";

/**
 * Which of `values` a job of these types may still act on: the values of the payload field
 * `field` among jobs that are queued (also delayed), waiting for a retry or running, or that
 * finished after `finishedSince` (a job that just finished may have sent a follow-up a moment
 * ago, or be the one whose result is being committed). Used by the stuck-row sweep: a pending row
 * none of whose jobs is in this set can never be moved on by the queue.
 */
export async function jobRefsInFlight(input: {
  jobs: readonly JobDefinition[];
  field: string;
  values: readonly string[];
  finishedSince: Date;
}): Promise<Set<string>> {
  if (input.values.length === 0 || input.jobs.length === 0) return new Set();
  const backend = await getBackend("web");
  return findJobRefs(backend, {
    names: input.jobs.map((j) => j.name),
    field: input.field,
    values: input.values,
    finishedSince: input.finishedSince,
  });
}

/** Resolves when the job queue answers (readiness); throws otherwise. */
export async function checkQueue(): Promise<void> {
  const backend = await getBackend("web");
  await pingQueue(backend);
}
