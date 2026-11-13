/**
 * Failure handling shared by every job area (script, pre-production, production): mapping an
 * error to user-readable text, and deciding between retrying, recording the failure and giving up.
 * Each area supplies its own wording (`FailureCopy`); the rules are the same everywhere.
 */
import { InsufficientCreditsError } from "../../src/server/billing";
import {
  DamiAbortedError,
  DamiApiError,
  DamiConfigError,
  DamiError,
  DamiInputError,
  DamiOutputError,
  DamiRefusalError,
  DamiTruncatedError,
} from "../../src/server/damis";
import {
  isLastAttempt,
  isShutdownAbort,
  type JobContext,
  type JobDefinition,
} from "../../src/server/jobs";
import { errorMessage, logLine } from "../../src/server/jobs/log";

export { isLastAttempt };

export type FailureDecision = {
  /** Shown to the user when the work is given up. */
  message: string;
  /** Another attempt could succeed (transient error, invalid output). */
  retryable: boolean;
  /** The dami run that failed, when there is one. */
  runId: string | null;
};

/** An error class whose message is written for the user (the area's input errors). */
type UserErrorClass = abstract new (...args: never[]) => Error;

/** One area's wording. Messages are shown to the user as they are. */
export type FailureCopy = {
  /** Errors whose own message is shown, never retried (`ScriptInputError`, ...). */
  userErrors: readonly UserErrorClass[];
  /** Map `InsufficientCreditsError` to "You need N credits..." (areas that spend credits). */
  credits: boolean;
  refusal: string;
  truncated: string;
  invalidInput: string;
  notConfigured: string;
  /** Anything unexpected (retried). */
  fallback: string;
};

const OUTPUT_UNUSABLE = "Claude's answer could not be used this time. Try again.";
const CLAUDE_BUSY = "Claude is busy right now. Try again in a few minutes.";
const CLAUDE_FAILED = "The request to Claude failed. Try again later.";
/** Recorded when the last attempt ran out of time. */
export const TOOK_TOO_LONG = "This took too long and was stopped. Try again.";

/** "You need N credits for this; you have M." */
export function creditsMessage(error: InsufficientCreditsError): string {
  const plural = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;
  return `You need ${plural(error.needed)} for this; you have ${error.balance}.`;
}

/** Maps an error from a dami job to user-readable text (in the area's words) and retryability. */
export function classifyDamiFailure(error: unknown, copy: FailureCopy): FailureDecision {
  const runId = error instanceof DamiError ? error.runId : null;
  const decide = (message: string, retryable: boolean): FailureDecision => ({
    message,
    retryable,
    runId,
  });
  if (copy.credits && error instanceof InsufficientCreditsError) {
    return decide(creditsMessage(error), false);
  }
  if (error instanceof Error && copy.userErrors.some((type) => error instanceof type)) {
    return decide(error.message, false);
  }
  // A dami stopped before it finished (its job's time ran out): another attempt may finish it.
  if (error instanceof DamiAbortedError) return decide(TOOK_TOO_LONG, true);
  if (error instanceof DamiRefusalError) return decide(copy.refusal, false);
  if (error instanceof DamiTruncatedError) return decide(copy.truncated, false);
  if (error instanceof DamiInputError) return decide(copy.invalidInput, false);
  if (error instanceof DamiConfigError) return decide(copy.notConfigured, false);
  if (error instanceof DamiOutputError) return decide(OUTPUT_UNUSABLE, true);
  if (error instanceof DamiApiError) {
    return error.transient ? decide(CLAUDE_BUSY, true) : decide(CLAUDE_FAILED, false);
  }
  return decide(copy.fallback, true);
}

/** Logs that a job gave up on its work (the user sees `failure`, when there is one). */
export function logGaveUp(
  job: JobDefinition,
  context: JobContext,
  error: unknown,
  failure?: string,
): void {
  logLine("error", "job gave up", {
    job: job.name,
    id: context.jobId,
    attempt: context.attempt,
    ...(failure !== undefined ? { failure } : {}),
    error: errorMessage(error),
  });
}

/**
 * Handles a failed attempt:
 * - interrupted by a worker shutdown: rethrown, nothing recorded (the queue delivers the job
 *   again without using up an attempt);
 * - expired (the attempt's signal aborted for taking too long, or a `DamiAbortedError`): rethrown
 *   so the queue retries; on the last attempt `record` stores a "took too long" failure first,
 *   so the domain row never stays pending;
 * - a retryable error before the last attempt: rethrown so the queue retries;
 * - otherwise `record` stores the failure; a non-retryable failure completes the job, one on the
 *   last attempt is rethrown after recording.
 */
export async function handleFailure(
  error: unknown,
  job: JobDefinition,
  context: JobContext,
  record: (decision: FailureDecision) => Promise<void>,
  classify: (error: unknown) => FailureDecision,
): Promise<void> {
  if (isShutdownAbort(context.signal)) throw error;
  const last = isLastAttempt(job, context);
  if (context.signal.aborted || error instanceof DamiAbortedError) {
    if (!last) throw error;
    const runId = error instanceof DamiError ? error.runId : null;
    await record({ message: TOOK_TOO_LONG, retryable: true, runId });
    logGaveUp(job, context, error, TOOK_TOO_LONG);
    throw error;
  }
  const decision = classify(error);
  if (decision.retryable && !last) throw error;
  await record(decision);
  logGaveUp(job, context, error, decision.message);
  if (last && decision.retryable) throw error;
}
