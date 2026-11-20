import type { DamiPrompt } from "../framework/define";
import { FILM_DIRECTOR_SYSTEM } from "./prompt-text";
import type { FilmDirectorCardInput } from "./schema";

const tag = (name: string, value: string) => `<${name}>\n${value}\n</${name}>`;

/** The section names of a Mode A card, in order (sections 0 to 14 of the master prompt). */
export const STYLE_CARD_SECTIONS = [
  "Identity",
  "Selection tags",
  "Directing logic",
  "Découpage",
  "Camera intent",
  "Staging and mise-en-scène",
  "Performance",
  "Rhythm and editing",
  "Sound",
  "Light and colour intent",
  "Signature devices",
  "Anti-defaults",
  "Translation to 15/30-second clips",
  "Director–cinematographer interface",
  "Calibration scene",
] as const;

/** Mode A: one director's name (and films) in, the Director Style Card out. */
export function buildFilmDirectorCardPrompt(input: FilmDirectorCardInput): DamiPrompt {
  const parts = [tag("director", input.director_name)];
  if (input.films && input.films.length > 0) parts.push(tag("films", input.films.join("\n")));
  parts.push(
    `Work in MODE A. Write the Director Style Card for this director${
      input.films && input.films.length > 0 ? ", analysing only the films listed" : ""
    }: exactly sections 0 to 14 in order, each as a Markdown heading "## <number>. <section name>". There is no chat here and no web search: put the whole card, in English, in \`card_markdown\` and nothing else. Return only the JSON object.`,
  );
  return {
    system: [{ text: FILM_DIRECTOR_SYSTEM, cache: true }],
    messages: [{ role: "user", content: [{ text: parts.join("\n\n") }] }],
  };
}
