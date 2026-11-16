import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildBlockRevisionPrompt } from "./prompt";
import {
  blockRevisionInputSchema,
  blockRevisionOutputSchema,
  type BlockRevisionInput,
} from "./schema";
import { checkBlockRevision } from "./validate";

/** Ours; the owner's Block Revision is v1.4 (`BLOCK_REVISION_OWNER_VERSION`). */
export const BLOCK_REVISION_VERSION = "1.0.0";
export const BLOCK_REVISION_OWNER_VERSION = "1.4";

/**
 * One revised block is ~2.5k tokens of JSON (staging lists, shots, prompt, change log, fix map)
 * plus thinking at medium effort; 16k leaves headroom without streaming.
 */
export const BLOCK_REVISION_MAX_OUTPUT_TOKENS = 16_000;

/**
 * BLOCK_REVISION (owner v1.4): the next version of one Seedance block from free-text change
 * requests, confirmed video-review issues, timed notes and asset corrections.
 * Default model is Sonnet; use `blockRevisionRunContext(input)` for the run context, which picks
 * Opus when `regenerate` is requested (the owner's rule).
 */
export const blockRevision = defineDami({
  key: "block-revision",
  version: BLOCK_REVISION_VERSION,
  description: `BLOCK_REVISION (owner v${BLOCK_REVISION_OWNER_VERSION}): revises one Seedance block (version N to N+1) with a minimal diff; Opus when regenerate is requested.`,
  input: blockRevisionInputSchema,
  output: blockRevisionOutputSchema,
  model: CLAUDE_MODELS.sonnet,
  effort: "medium",
  maxOutputTokens: BLOCK_REVISION_MAX_OUTPUT_TOKENS,
  build: buildBlockRevisionPrompt,
  check: checkBlockRevision,
});

/** Opus for a regenerate (a new shot plan), Sonnet for everything else. */
export function blockRevisionModel(input: Pick<BlockRevisionInput, "requests">): string {
  return input.requests.regenerate === true ? CLAUDE_MODELS.opus : CLAUDE_MODELS.sonnet;
}

/** The `DamiRunContext` fields for this request; spread into the context passed to `runDami`. */
export function blockRevisionRunContext(input: Pick<BlockRevisionInput, "requests">): {
  model: string;
} {
  return { model: blockRevisionModel(input) };
}
