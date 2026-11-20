import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildCinematographerV1Prompt } from "./prompt";
import {
  cinematographerLookInputSchema,
  cinematographerRelightInputSchema,
  cinematographerShotsInputSchema,
  cinematographerShotsOutputSchema,
  lookOutputSchema,
  relightOutputSchema,
} from "./schema";
import { checkCinematographerShots, checkLook, checkRelight } from "./validate";

/** Ours; the owner's file is CINEMATOGRAPHER v1.0 (`CINEMATOGRAPHER_OWNER_VERSION`). */
export const CINEMATOGRAPHER_VERSION = "1.0.0";
export const CINEMATOGRAPHER_OWNER_VERSION = "1.0";

/**
 * CINEMATOGRAPHER v1.0, mode `look`: the project's frozen look bible (look_line, light setups and
 * their light_lines, lens and movement language), in the chosen DP card's style. Once per project.
 * Opus (the owner's header). A look bible is ~2 to 4k tokens of JSON.
 */
export const cinematographerLook = defineDami({
  key: "cinematographer-look",
  version: CINEMATOGRAPHER_VERSION,
  description: `CINEMATOGRAPHER (owner v${CINEMATOGRAPHER_OWNER_VERSION}, output_22_dp), mode look: the project's look bible in the chosen director of photography's style.`,
  input: cinematographerLookInputSchema,
  output: lookOutputSchema,
  model: CLAUDE_MODELS.opus,
  effort: "medium",
  maxOutputTokens: 12_000,
  build: buildCinematographerV1Prompt,
  check: checkLook,
});

/**
 * Mode `shots`: each shot of a scene range gets its light setup, lens, support, move execution,
 * composition and pasteable phrases. Sonnet, Opus on the corrective retry (the owner's header).
 * ~300 to 400 tokens per shot; a batch of ~30 shots fits in 16k.
 */
export const cinematographerShots = defineDami({
  key: "cinematographer-shots",
  version: CINEMATOGRAPHER_VERSION,
  description: `CINEMATOGRAPHER (owner v${CINEMATOGRAPHER_OWNER_VERSION}), mode shots: the cinematography and ready-to-paste phrases of every shot in a scene range.`,
  input: cinematographerShotsInputSchema,
  output: cinematographerShotsOutputSchema,
  model: CLAUDE_MODELS.sonnet,
  retryModel: CLAUDE_MODELS.opus,
  effort: "low",
  maxOutputTokens: 16_000,
  build: buildCinematographerV1Prompt,
  check: checkCinematographerShots,
});

/** Mode `relight`: rewrites a location's light setups to match its approved sheet. Opus. */
export const cinematographerRelight = defineDami({
  key: "cinematographer-relight",
  version: CINEMATOGRAPHER_VERSION,
  description: `CINEMATOGRAPHER (owner v${CINEMATOGRAPHER_OWNER_VERSION}), mode relight: rewrites the light setups of one location to match its approved sheet.`,
  input: cinematographerRelightInputSchema,
  output: relightOutputSchema,
  model: CLAUDE_MODELS.opus,
  effort: "low",
  maxOutputTokens: 6_000,
  build: buildCinematographerV1Prompt,
  check: checkRelight,
});
