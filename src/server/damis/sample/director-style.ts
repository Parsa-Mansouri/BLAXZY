/** Sample Mode A of the Director master prompt: a skeleton card with every section heading. */
import { STYLE_CARD_SECTIONS } from "../director-style/prompt";
import { filmDirectorCardInputSchema, type FilmDirectorCardOutput } from "../director-style/schema";

export function sampleFilmDirectorCard(raw: unknown): FilmDirectorCardOutput {
  const input = filmDirectorCardInputSchema.parse(raw);
  const films = input.films?.join(", ") ?? "four to six representative films";
  const sections = STYLE_CARD_SECTIONS.map(
    (name, i) =>
      `## ${i}. ${name}\n${i === 0 ? `${input.director_name}. Films analysed: ${films}.` : "Sample text: run film-director-card live for the real card."}`,
  );
  return {
    card_markdown: [`# Director Style Card — ${input.director_name}`, ...sections].join("\n\n"),
  };
}
