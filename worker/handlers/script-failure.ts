import {
  DamiApiError,
  DamiConfigError,
  DamiError,
  DamiInputError,
  DamiOutputError,
  DamiRefusalError,
  DamiTruncatedError,
} from "../../src/server/damis";
import type { JobContext, JobDefinition } from "../../src/server/jobs";
import { ScriptInputError } from "../../src/server/script";

export type FailureDecision = {
  /** Shown to the user when the work is given up. */
  message: string;
  /** Another attempt could succeed (transient error, invalid output). */
  retryable: boolean;
  /** The dami run that failed, when there is one. */
  runId: string | null;
};

/** Maps an error from a script job to user-readable text and whether a retry can help. */
export function classifyFailure(error: unknown): FailureDecision {
  const runId = error instanceof DamiError ? error.runId : null;
  if (error instanceof ScriptInputError) {
    return { message: error.message, retryable: false, runId };
  }
  if (error instanceof DamiRefusalError) {
    return {
      message:
        "Claude declined this request. Rephrase the brief or the script so it stays clear of sensitive content, then try again.",
      retryable: false,
      runId,
    };
  }
  if (error instanceof DamiTruncatedError) {
    return {
      message:
        "The result came out too long to finish in one go. Try a shorter duration or a shorter script.",
      retryable: false,
      runId,
    };
  }
  if (error instanceof DamiConfigError) {
    return {
      message:
        "Script writing is not set up on this server (the Claude API key is missing). Contact support.",
      retryable: false,
      runId,
    };
  }
  if (error instanceof DamiInputError) {
    return {
      message:
        "This script could not be processed: it is empty or too long. Check it and try again.",
      retryable: false,
      runId,
    };
  }
  if (error instanceof DamiOutputError) {
    return {
      message: "Claude's answer could not be used this time. Try again.",
      retryable: true,
      runId,
    };
  }
  if (error instanceof DamiApiError) {
    return error.transient
      ? {
          message: "Claude is busy right now. Try again in a few minutes.",
          retryable: true,
          runId,
        }
      : { message: "The request to Claude failed. Try again later.", retryable: false, runId };
  }
  return {
    message: "Something went wrong while preparing the script. Try again.",
    retryable: true,
    runId,
  };
}

/** The attempt is the job's last (pg-boss will not retry it). */
export function isLastAttempt(job: JobDefinition, context: JobContext): boolean {
  return context.attempt > job.options.retryLimit;
}

/**
 * Handles a failed attempt: an aborted attempt (expired or shutdown) and a retryable error before
 * the last attempt are rethrown so the queue retries; otherwise `record` stores the failure. A
 * non-retryable failure completes the job; one on the last attempt is rethrown after recording.
 */
export async function handleFailure(
  error: unknown,
  job: JobDefinition,
  context: JobContext,
  record: (decision: FailureDecision) => Promise<void>,
  classify: (error: unknown) => FailureDecision = classifyFailure,
): Promise<void> {
  if (context.signal.aborted) throw error;
  const decision = classify(error);
  const last = isLastAttempt(job, context);
  if (decision.retryable && !last) throw error;
  await record(decision);
  console.error(
    JSON.stringify({
      time: new Date().toISOString(),
      level: "error",
      msg: "job gave up",
      job: job.name,
      id: context.jobId,
      attempt: context.attempt,
      failure: decision.message,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  if (last && decision.retryable) throw error;
}
