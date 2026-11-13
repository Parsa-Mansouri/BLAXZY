import { GenerationInputError } from "../../src/server/generation";
import { ProductionInputError } from "../../src/server/production";
import { classifyDamiFailure, type FailureCopy, type FailureDecision } from "./failure";

/** The production area's wording. */
export const PRODUCTION_FAILURE_COPY: FailureCopy = {
  userErrors: [ProductionInputError, GenerationInputError],
  credits: true,
  refusal:
    "Claude declined to write this shot's prompt. Change the shot (or its review), then try again.",
  truncated: "This shot could not be turned into a video prompt. Shorten it and try again.",
  invalidInput: "This shot could not be turned into a video prompt. Shorten it and try again.",
  notConfigured:
    "Video prompts cannot be written on this server (the Claude API key is missing). Contact support.",
  fallback: "Something went wrong while preparing this shot. Try again.",
};

/** Maps an error from a Production job to user-readable text and whether a retry can help. */
export function classifyProductionFailure(error: unknown): FailureDecision {
  return classifyDamiFailure(error, PRODUCTION_FAILURE_COPY);
}
