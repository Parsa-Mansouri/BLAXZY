import { classifyDamiFailure, type FailureCopy, type FailureDecision } from "./failure";

/** The script area's wording. */
export const SCRIPT_FAILURE_COPY: FailureCopy = {
  userErrors: true,
  credits: false,
  refusal:
    "Claude declined this request. Rephrase the brief or the script so it stays clear of sensitive content, then try again.",
  truncated:
    "The result came out too long to finish in one go. Try a shorter duration or a shorter script.",
  invalidInput:
    "This script could not be processed: it is empty or too long. Check it and try again.",
  notConfigured:
    "Script writing is not set up on this server (the Claude API key is missing). Contact support.",
  fallback: "Something went wrong while preparing the script. Try again.",
};

/** Maps an error from a script job to user-readable text and whether a retry can help. */
export function classifyFailure(error: unknown): FailureDecision {
  return classifyDamiFailure(error, SCRIPT_FAILURE_COPY);
}
