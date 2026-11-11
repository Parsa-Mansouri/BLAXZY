import { InsufficientCreditsError } from "../../src/server/billing";
import {
  DamiApiError,
  DamiConfigError,
  DamiError,
  DamiInputError,
  DamiOutputError,
  DamiRefusalError,
  DamiTruncatedError,
} from "../../src/server/damis";
import { GenerationInputError } from "../../src/server/generation";
import { ProductionInputError } from "../../src/server/production";
import { creditsMessage } from "./asset-failure";
import type { FailureDecision } from "./script-failure";

/** Maps an error from a Production job to user-readable text and whether a retry can help. */
export function classifyProductionFailure(error: unknown): FailureDecision {
  const runId = error instanceof DamiError ? error.runId : null;
  if (error instanceof InsufficientCreditsError) {
    return { message: creditsMessage(error), retryable: false, runId };
  }
  if (error instanceof ProductionInputError || error instanceof GenerationInputError) {
    return { message: error.message, retryable: false, runId };
  }
  if (error instanceof DamiRefusalError) {
    return {
      message:
        "Claude declined to write this shot's prompt. Change the shot (or its review), then try again.",
      retryable: false,
      runId,
    };
  }
  if (error instanceof DamiTruncatedError || error instanceof DamiInputError) {
    return {
      message: "This shot could not be turned into a video prompt. Shorten it and try again.",
      retryable: false,
      runId,
    };
  }
  if (error instanceof DamiConfigError) {
    return {
      message:
        "Video prompts cannot be written on this server (the Claude API key is missing). Contact support.",
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
      ? { message: "Claude is busy right now. Try again in a few minutes.", retryable: true, runId }
      : { message: "The request to Claude failed. Try again later.", retryable: false, runId };
  }
  return {
    message: "Something went wrong while preparing this shot. Try again.",
    retryable: true,
    runId,
  };
}
