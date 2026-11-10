import { z } from "zod";
import { projectStyleSchema } from "../shared/style";

export const scriptWriterInputSchema = z.object({
  style: projectStyleSchema,
  /** The user's short description of the film. */
  brief: z.string().trim().min(1).max(20_000),
});

export const scriptWriterOutputSchema = z.object({
  title: z.string().trim().min(1).max(120).describe("The film's title, in the script's language."),
  logline: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe("One sentence: protagonist, goal, obstacle, stakes. In the script's language."),
  content: z
    .string()
    .describe(
      "The complete screenplay as plain text. Empty only when nothing safe can be written.",
    ),
  notes: z
    .array(z.string().trim().min(1).max(400))
    .max(8)
    .describe("Short remarks for the director, in English: assumptions made, things to check."),
});

export type ScriptWriterInput = z.input<typeof scriptWriterInputSchema>;
export type ScriptWriterOutput = z.output<typeof scriptWriterOutputSchema>;
