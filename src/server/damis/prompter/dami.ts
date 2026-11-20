import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildPrompterPrompt } from "./prompt";
import { prompterInputSchema, prompterOutputSchema } from "./schema";
import { checkPrompter } from "./validate";

/** Ours; the owner's file is PROMPTER v1.0 (`PROMPTER_OWNER_VERSION`). */
export const PROMPTER_VERSION = "1.0.0";
export const PROMPTER_OWNER_VERSION = "1.0";

/**
 * PROMPTER v1.0: writes the Seedance 2.5 prompt of each BREAKDOWN unit (block or shot) from the
 * decisions DIRECTOR, CINEMATOGRAPHER and BREAKDOWN already made. Batches of ~8 units, which may
 * run in parallel. Sonnet; Opus on the corrective retry (the owner's header). A unit is ~400 to
 * 700 tokens of prompt plus its fields; 16k covers a batch of 8 with thinking at medium effort.
 */
export const prompter = defineDami({
  key: "prompter",
  version: PROMPTER_VERSION,
  description: `PROMPTER (owner v${PROMPTER_OWNER_VERSION}): writes one self-contained Seedance 2.5 prompt per generation unit from the director's, cinematographer's and breakdown's decisions.`,
  input: prompterInputSchema,
  output: prompterOutputSchema,
  model: CLAUDE_MODELS.sonnet,
  retryModel: CLAUDE_MODELS.opus,
  effort: "medium",
  maxOutputTokens: 16_000,
  build: buildPrompterPrompt,
  check: checkPrompter,
});
