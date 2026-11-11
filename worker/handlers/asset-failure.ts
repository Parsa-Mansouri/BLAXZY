import { AssetInputError } from "../../src/server/assets";
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
import type { FailureDecision } from "./script-failure";

/** "You need N credits for this; you have M." */
export function creditsMessage(error: InsufficientCreditsError): string {
  const plural = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;
  return `You need ${plural(error.needed)} for this; you have ${error.balance}.`;
}

/** Maps an error from a pre-production job to user-readable text and whether a retry can help. */
export function classifyAssetFailure(error: unknown): FailureDecision {
  const runId = error instanceof DamiError ? error.runId : null;
  if (error instanceof InsufficientCreditsError) {
    return { message: creditsMessage(error), retryable: false, runId };
  }
  if (error instanceof AssetInputError || error instanceof GenerationInputError) {
    return { message: error.message, retryable: false, runId };
  }
  if (error instanceof DamiRefusalError) {
    return {
      message:
        "Claude declined to write this image prompt. Describe the asset differently, then try again.",
      retryable: false,
      runId,
    };
  }
  if (error instanceof DamiTruncatedError || error instanceof DamiInputError) {
    return {
      message:
        "This description could not be turned into an image prompt. Shorten it and try again.",
      retryable: false,
      runId,
    };
  }
  if (error instanceof DamiConfigError) {
    return {
      message:
        "Image prompts cannot be written on this server (the Claude API key is missing). Contact support.",
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
    message: "Something went wrong while preparing this image. Try again.",
    retryable: true,
    runId,
  };
}
