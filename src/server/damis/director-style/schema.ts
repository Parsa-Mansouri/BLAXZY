import { z } from "zod";

/** Mode A: the Director Style Card of one director. */
export const filmDirectorCardInputSchema = z.object({
  director_name: z.string().trim().min(1).max(200),
  /** Films (or a period) to analyse; omitted: the model picks 4 to 6 representative films. */
  films: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
});
export type FilmDirectorCardInput = z.output<typeof filmDirectorCardInputSchema>;

/** Mode A: the Director Style Card as Markdown, sections 0 to 14. */
export const filmDirectorCardOutputSchema = z.object({ card_markdown: z.string() });
export type FilmDirectorCardOutput = z.output<typeof filmDirectorCardOutputSchema>;
