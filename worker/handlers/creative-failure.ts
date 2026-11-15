import { classifyDamiFailure, type FailureCopy, type FailureDecision } from "./failure";

/** The Creative Bible's wording. */
export const CREATIVE_FAILURE_COPY: FailureCopy = {
  userErrors: [],
  credits: false,
  refusal:
    "Claude declined to prepare the creative rules for this project. Change the genre or style and try again.",
  truncated: "The creative rules came out too long to finish. Try again.",
  invalidInput: "The creative rules could not be prepared from this project's style.",
  notConfigured:
    "Creative rules are not set up on this server (the Claude API key is missing). Contact support.",
  fallback: "Something went wrong while preparing the creative rules. Try again.",
};

/** Maps an error from the Creative DNA job to user-readable text and whether a retry can help. */
export function classifyCreativeFailure(error: unknown): FailureDecision {
  return classifyDamiFailure(error, CREATIVE_FAILURE_COPY);
}
