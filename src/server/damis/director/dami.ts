import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildDirectorPrompt } from "./prompt";
import {
  directorInputSchema,
  directorOutputSchema,
  directorPlanInputSchema,
  directorPlanOutputSchema,
} from "./schema";
import { checkDirector, checkDirectorPlan } from "./validate";

/** Ours; the owner's Director is v1.3 (`DIRECTOR_OWNER_VERSION`). */
export const DIRECTOR_VERSION = "1.0.0";
export const DIRECTOR_OWNER_VERSION = "1.3";

/**
 * Output budget: the owner estimates ~500 tokens of prompt per block, and a written block also
 * carries two staging lists, the shot plan (with dialogue) and rationales, about 1.5 to 2.5k
 * tokens in JSON. `full` is for scripts of 8 blocks or fewer (~20k), `write_blocks` runs batches of
 * ~8, and the project header (analysis, notes, continuity bible) adds ~4k; thinking at medium
 * effort counts against the limit. 32k covers that with headroom and streams (over 16k).
 * A plan block has no shots or prompt (~700 tokens), so one plan pass of up to ~40 blocks fits.
 */
export const DIRECTOR_MAX_OUTPUT_TOKENS = 32_000;

/**
 * DIRECTOR (owner v1.3): directs the approved script and divides it into Seedance blocks. This
 * dami answers `full` (for scripts of up to ~8 blocks) and `write_blocks` (a batch of a saved
 * plan). Run by `script.direct` and `direction.write`.
 */
export const director = defineDami({
  key: "director",
  version: DIRECTOR_VERSION,
  description: `DIRECTOR (owner v${DIRECTOR_OWNER_VERSION}, output_22), modes full and write_blocks: directs the approved script and writes its 15 or 30 second Seedance prompt blocks with staging, shot plan and continuity bible. Runs once in the background after script approval.`,
  input: directorInputSchema,
  output: directorOutputSchema,
  // Opus: one expensive call per project that every block of the film depends on; the owner
  // names claude-opus-5-5 for it.
  model: CLAUDE_MODELS.opus,
  effort: "medium",
  maxOutputTokens: DIRECTOR_MAX_OUTPUT_TOKENS,
  build: buildDirectorPrompt,
  check: checkDirector,
});

/**
 * The same DIRECTOR in mode `plan`: dramatic analysis, directors_notes, the continuity bible and
 * the blocks without shots, prompt_text and word_count. Its own dami (like script-writer-outline)
 * because structured output needs one closed schema per answer shape; it shares the prompt, the
 * checks and the model.
 */
export const directorPlan = defineDami({
  key: "director-plan",
  version: DIRECTOR_VERSION,
  description: `DIRECTOR (owner v${DIRECTOR_OWNER_VERSION}, output_22), mode plan: the plan pass for longer scripts (blocks without shots or prompt_text); write_blocks then writes them in batches.`,
  input: directorPlanInputSchema,
  output: directorPlanOutputSchema,
  model: CLAUDE_MODELS.opus,
  effort: "medium",
  maxOutputTokens: DIRECTOR_MAX_OUTPUT_TOKENS,
  build: buildDirectorPrompt,
  check: checkDirectorPlan,
});
