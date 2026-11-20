import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildCinematographerPrompt } from "./prompt";
import { cinematographerInputSchema, cinematographerOutputSchema } from "./schema";
import { checkCinematographer, finalizeCinematographer } from "./validate";

/** Ours; each card carries its own owner version (`library.ts`). */
export const CINEMATOGRAPHER_VERSION = "1.0.0";

/**
 * A look is ~1.5k tokens and a scene ~250 per shot; low effort thinks little. 8k covers a scene of
 * ~20 shots without streaming.
 */
export const CINEMATOGRAPHER_MAX_OUTPUT_TOKENS = 8_000;

/**
 * CINEMATOGRAPHER (step 2 of the craft pipeline): one of the owner's six DP cards as the system
 * prompt. Mode `look` runs once per film (the camera and light language, one card mode per scene);
 * mode `scene` runs per scene (lens, light, framing, grade and texture per shot).
 */
export const cinematographer = defineDami({
  key: "cinematographer",
  version: CINEMATOGRAPHER_VERSION,
  description:
    "CINEMATOGRAPHER (owner DP cards): mode look sets the film's camera and light language and one card mode per scene; mode scene gives each shot of a scene its lens, light, framing, grade and texture.",
  input: cinematographerInputSchema,
  output: cinematographerOutputSchema,
  // Sonnet at low effort: the card already holds the decisions; the job is applying them.
  model: CLAUDE_MODELS.sonnet,
  effort: "low",
  maxOutputTokens: CINEMATOGRAPHER_MAX_OUTPUT_TOKENS,
  build: buildCinematographerPrompt,
  check: checkCinematographer,
  finalize: finalizeCinematographer,
});
