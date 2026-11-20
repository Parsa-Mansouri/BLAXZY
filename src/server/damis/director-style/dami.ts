import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildFilmDirectorCardPrompt } from "./prompt";
import { filmDirectorCardInputSchema, filmDirectorCardOutputSchema } from "./schema";
import { checkStyleCard } from "./validate";

/** Ours. The owner's master prompt carries no version; `DIRECTOR_STYLE_OWNER_VERSION` names it. */
export const DIRECTOR_STYLE_VERSION = "1.0.0";
export const DIRECTOR_STYLE_OWNER_VERSION = "master-1";

/**
 * The owner's Director master prompt in MODE A: one director's name in, a Director Style Card out
 * (sections 0 to 14 as Markdown). Run by hand
 * (`pnpm dami:run film-director-card src/server/damis/director-style/fixtures/card-input.json --live`);
 * the reviewed card is then committed under `styles/` with one library entry, and DIRECTOR v2.0
 * receives it as `<director_style_card>`. The master prompt's MODE B is not run: DIRECTOR v2.0
 * directs.
 */
export const filmDirectorCard = defineDami({
  key: "film-director-card",
  version: DIRECTOR_STYLE_VERSION,
  description: `DIRECTOR STYLE CARD (owner master prompt ${DIRECTOR_STYLE_OWNER_VERSION}, Mode A): writes the Director Style Card of one director, sections 0 to 14 as Markdown.`,
  input: filmDirectorCardInputSchema,
  output: filmDirectorCardOutputSchema,
  model: CLAUDE_MODELS.opus,
  effort: "high",
  maxOutputTokens: 24_000,
  build: buildFilmDirectorCardPrompt,
  check: checkStyleCard,
});
