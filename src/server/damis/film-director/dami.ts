import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildFilmDirectorCardPrompt, buildFilmDirectorPrompt } from "./prompt";
import {
  filmDirectorCardInputSchema,
  filmDirectorCardOutputSchema,
  filmDirectorInputSchema,
  shotPlanSchema,
} from "./schema";
import { checkShotPlan, checkStyleCard } from "./validate";

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
 * FILM DIRECTOR (step 1 of the craft pipeline): directs the approved script with a Director Style
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

/**
 * The same master prompt in MODE A: one director's name in, a Director Style Card out (sections 0
 * to 14 as Markdown). Run by hand (`pnpm dami:run film-director-card <input.json> --live`); the
 * reviewed card is then committed under `film-director/styles/`.
 */
export const filmDirectorCard = defineDami({
  key: "film-director-card",
  version: FILM_DIRECTOR_VERSION,
  description: `FILM DIRECTOR (owner master prompt ${FILM_DIRECTOR_OWNER_VERSION}, Mode A): writes the Director Style Card of one director, sections 0 to 14 as Markdown.`,
  input: filmDirectorCardInputSchema,
  output: filmDirectorCardOutputSchema,
  model: CLAUDE_MODELS.opus,
  effort: "high",
  maxOutputTokens: 24_000,
  build: buildFilmDirectorCardPrompt,
  check: checkStyleCard,
});
