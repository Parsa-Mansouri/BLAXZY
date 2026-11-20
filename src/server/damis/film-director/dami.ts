import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildFilmDirectorPrompt } from "./prompt";
import { filmDirectorInputSchema, shotPlanSchema } from "./schema";
import { checkShotPlan } from "./validate";

/** Ours. The owner's master prompt carries no version; `FILM_DIRECTOR_OWNER_VERSION` names it. */
export const FILM_DIRECTOR_VERSION = "1.0.0";
export const FILM_DIRECTOR_OWNER_VERSION = "master-1";

/**
 * Output budget, as for the v1.4 Director: a shot with full staging is ~400 to 700 tokens of JSON,
 * a 3 to 5 minute film runs 40 to 80 shots, plus notes, geography and beats; thinking at medium
 * effort counts against it. 32k streams (over 16k).
 */
export const FILM_DIRECTOR_MAX_OUTPUT_TOKENS = 32_000;

/**
 * DEPRECATED: replaced by the owner's DIRECTOR v2.0 (`../director-v2/`) with the style card as an
 * input; this folder is deleted when the worker is rewired. Mode A (`film-director-card`) and the
 * style cards live in `../director-style/`.
 *
 * FILM DIRECTOR (step 1 of the provisional craft pipeline): directs the approved script with a Director Style
 * Card (MODE B, steps 1, 2, 4, 5 and 7 only) into a shot plan with geography and full staging. No
 * prompt text and no physical descriptions: the cinematographer adds the look, the Breakdown
 * groups shots into blocks and the prompter writes them.
 */
export const filmDirector = defineDami({
  key: "film-director",
  version: FILM_DIRECTOR_VERSION,
  description: `FILM DIRECTOR (owner master prompt ${FILM_DIRECTOR_OWNER_VERSION}, Mode B): directs the approved script with a Director Style Card into an ordered shot plan with scene geography, staging, dialogue and timing.`,
  input: filmDirectorInputSchema,
  output: shotPlanSchema,
  // Opus: one expensive call per project that every later step depends on.
  model: CLAUDE_MODELS.opus,
  effort: "medium",
  maxOutputTokens: FILM_DIRECTOR_MAX_OUTPUT_TOKENS,
  build: buildFilmDirectorPrompt,
  check: checkShotPlan,
});
