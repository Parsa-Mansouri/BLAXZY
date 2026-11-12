import { z } from "zod";

/** The owner's genre names (PART 2 of `source/blaxzy_enhancer_dami.md`), exactly as written. */
export const OWNER_ENHANCER_GENRES = [
  "Drama",
  "Comedy",
  "Horror",
  "Thriller",
  "Action",
  "Science Fiction",
] as const;
export type OwnerEnhancerGenre = (typeof OWNER_ENHANCER_GENRES)[number];

/** The owner's visual-style names (PART 3), exactly as written. */
export const OWNER_ENHANCER_STYLES = [
  "Realistic",
  "Noir",
  "Futuristic",
  "Horror Visual Style",
  "3D Animation",
  "Anime",
  "Claymation",
] as const;
export type OwnerEnhancerStyle = (typeof OWNER_ENHANCER_STYLES)[number];

/**
 * The caller maps BLAXZY's genre/style values to the owner's names; anything without an owner
 * block ("Other", unknown values) becomes null, so that domain is simply inactive.
 */
export const enhancerInputSchema = z.object({
  userPrompt: z.string().trim().min(1).max(20_000),
  genre: z.enum(OWNER_ENHANCER_GENRES).nullable(),
  visualStyle: z.enum(OWNER_ENHANCER_STYLES).nullable(),
});

/** The owner's OUTPUT FORMAT, field names kept as written (snake_case). */
export const enhancerOutputSchema = z.object({
  status: z.enum(["ok", "error"]),
  enhanced_prompt: z
    .string()
    .nullable()
    .describe("The final prompt in English, scenes separated by a blank line; null on error."),
  look_line: z
    .string()
    .nullable()
    .describe("One sentence (max 40 words) with the global look; null when no style is active."),
  applied: z.object({
    genre: z.string().nullable(),
    visual_style: z.string().nullable(),
  }),
  overrides: z
    .array(z.string())
    .describe("One short sentence per user-vs-enhancer conflict resolved, or an empty array."),
  error: z.string().nullable().describe("A short reason when status is error, else null."),
});

export type EnhancerInput = z.input<typeof enhancerInputSchema>;
export type EnhancerOutput = z.output<typeof enhancerOutputSchema>;
