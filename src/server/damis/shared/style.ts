import { z } from "zod";
import {
  MAX_REFERENCE_DESCRIPTION_CHARS,
  MAX_REFERENCE_IMAGES,
  MAX_REFERENCE_TITLE_CHARS,
  MAX_REFERENCE_TITLES,
} from "@/lib/style-references";
import { ORIENTATIONS, PROJECT_FORMATS, type ProjectStyle } from "@/server/db/schema";

/** A look or genre the user described themselves: at least one of names, images or words. */
export const styleReferenceSchema = z
  .object({
    titles: z
      .array(z.string().trim().min(1).max(MAX_REFERENCE_TITLE_CHARS))
      .max(MAX_REFERENCE_TITLES),
    description: z.string().trim().min(1).max(MAX_REFERENCE_DESCRIPTION_CHARS).optional(),
    fileIds: z.array(z.uuid()).max(MAX_REFERENCE_IMAGES),
  })
  .refine((r) => r.titles.length > 0 || r.fileIds.length > 0 || r.description !== undefined, {
    message: "a reference needs a name, an image or a description",
  });

/** Zod mirror of `ProjectStyle` (Output_01), the input every dami is tailored to. */
export const projectStyleSchema = z
  .object({
    visualStyle: z.string().trim().min(1),
    genre: z.string().trim().min(1),
    format: z.enum(PROJECT_FORMATS),
    orientation: z.enum(ORIENTATIONS),
    totalDurationSeconds: z.number().int().positive(),
    episodeDurationSeconds: z.number().int().positive().optional(),
    extras: z.record(z.string(), z.string()).optional(),
    references: z
      .object({
        visualStyle: styleReferenceSchema.optional(),
        genre: styleReferenceSchema.optional(),
      })
      .optional(),
    styleDescriptor: z.string().trim().min(1).max(2000).optional(),
    lookLine: z.string().trim().min(1).max(1000).optional(),
    eraSetting: z.string().trim().min(1).max(500).optional(),
    artDirectionNotes: z.string().trim().min(1).max(4000).optional(),
    audienceRating: z.string().trim().min(1).max(40).optional(),
  })
  .superRefine((style, ctx) => {
    if (style.format === "series" && style.episodeDurationSeconds === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["episodeDurationSeconds"],
        message: "a series needs episodeDurationSeconds",
      });
    }
    if (
      style.episodeDurationSeconds !== undefined &&
      style.episodeDurationSeconds > style.totalDurationSeconds
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["episodeDurationSeconds"],
        message: "an episode cannot be longer than the whole series",
      });
    }
  });

// Compile-time guarantee that the schema and the database type stay in sync.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const styleSchemaMatchesDb: Equals<z.output<typeof projectStyleSchema>, ProjectStyle> = true;
void styleSchemaMatchesDb;

/** Screen time is estimated at ~170 words of screenplay text per minute (≈ one page). */
export const WORDS_PER_MINUTE = 170;

export type DurationPlan = {
  totalSeconds: number;
  /** Number of episodes for a series, null for a movie. */
  episodes: number | null;
  episodeSeconds: number | null;
  /** Target word count for the whole script. */
  targetWords: number;
  /** Target word count per episode (series) or null. */
  targetWordsPerEpisode: number | null;
};

export function planDuration(style: ProjectStyle): DurationPlan {
  const words = (seconds: number) => Math.max(20, Math.round((seconds / 60) * WORDS_PER_MINUTE));
  if (style.format === "series" && style.episodeDurationSeconds) {
    const episodes = Math.max(
      1,
      Math.round(style.totalDurationSeconds / style.episodeDurationSeconds),
    );
    return {
      totalSeconds: style.totalDurationSeconds,
      episodes,
      episodeSeconds: style.episodeDurationSeconds,
      targetWords: words(style.episodeDurationSeconds) * episodes,
      targetWordsPerEpisode: words(style.episodeDurationSeconds),
    };
  }
  return {
    totalSeconds: style.totalDurationSeconds,
    episodes: null,
    episodeSeconds: null,
    targetWords: words(style.totalDurationSeconds),
    targetWordsPerEpisode: null,
  };
}

export function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} s`;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}
