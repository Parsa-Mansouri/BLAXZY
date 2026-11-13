import { AssetInputError } from "../../src/server/assets";
import { GenerationInputError } from "../../src/server/generation";
import { classifyDamiFailure, type FailureCopy, type FailureDecision } from "./failure";

/** The pre-production area's wording. */
export const ASSET_FAILURE_COPY: FailureCopy = {
  userErrors: [AssetInputError, GenerationInputError],
  credits: true,
  refusal:
    "Claude declined to write this image prompt. Describe the asset differently, then try again.",
  truncated: "This description could not be turned into an image prompt. Shorten it and try again.",
  invalidInput:
    "This description could not be turned into an image prompt. Shorten it and try again.",
  notConfigured:
    "Image prompts cannot be written on this server (the Claude API key is missing). Contact support.",
  fallback: "Something went wrong while preparing this image. Try again.",
};

/** Maps an error from a pre-production job to user-readable text and whether a retry can help. */
export function classifyAssetFailure(error: unknown): FailureDecision {
  return classifyDamiFailure(error, ASSET_FAILURE_COPY);
}
