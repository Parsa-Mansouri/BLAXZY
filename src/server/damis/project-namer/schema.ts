import { z } from "zod";

/** The longest title the namer may return (the project title column allows more). */
export const NAME_MAX_CHARS = 60;
/** How much of the story the namer reads; the title does not need more. */
export const NAME_STORY_MAX_CHARS = 6000;

/** The first words of a story, cut at a word boundary, for the namer's input. */
export function storyExcerpt(story: string): string {
  const text = story.trim();
  if (text.length <= NAME_STORY_MAX_CHARS) return text;
  const cut = text.slice(0, NAME_STORY_MAX_CHARS);
  const space = cut.lastIndexOf(" ");
  return (space > NAME_STORY_MAX_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd();
}

/**
 * What the namer reads: the project's genre, visual style and format as the Style stage stored
 * them (readable text, a typed "Other" included) and the story the user first gave.
 */
export const projectNamerInputSchema = z.object({
  genre: z.string().trim().min(1).max(500).nullable(),
  visualStyle: z.string().trim().min(1).max(500).nullable(),
  format: z.string().trim().min(1).max(40).nullable(),
  story: z
    .string()
    .trim()
    .min(1)
    .max(NAME_STORY_MAX_CHARS + 2000),
});

export const projectNamerOutputSchema = z.object({
  title: z.string().describe("The film's title: 1 to 60 characters, in the story's language."),
});

export type ProjectNamerInput = z.output<typeof projectNamerInputSchema>;
export type ProjectNamerOutput = z.output<typeof projectNamerOutputSchema>;
