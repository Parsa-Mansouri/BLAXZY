import { episodeCount } from "@/lib/style-options";
import type { ProjectStyle } from "@/server/db/schema";
import { registryIdsForStyle } from "./registry";
import type { CreativeDnaInput } from "./schema";

/** The language the UI of this platform is in (the labels of the review options). */
export const CREATIVE_UI_LANGUAGE = "en";

/**
 * The Creative DNA input for a project's saved Style, or null when the genre or the visual style
 * is a typed "Other" (no bible for such projects). A movie is one episode as long as the film.
 * What the Style stage does not collect (audience, dialogue policy, brief, locks) stays absent;
 * `audienceRating` is the audience, and the script language is the style's `language` extra.
 */
export function creativeDnaInputFromStyle(style: ProjectStyle): CreativeDnaInput | null {
  const ids = registryIdsForStyle(style);
  if (!ids) return null;
  const series = style.format === "series" && style.episodeDurationSeconds !== undefined;
  const language = style.extras?.language?.trim();
  return {
    genre_id: ids.genreId,
    style_id: ids.styleId,
    format: series ? "series" : "film",
    episode_count: series
      ? episodeCount(style.totalDurationSeconds, style.episodeDurationSeconds ?? 1)
      : null,
    episode_duration_sec: series
      ? (style.episodeDurationSeconds ?? null)
      : style.totalDurationSeconds,
    total_duration_sec: style.totalDurationSeconds,
    orientation: style.orientation,
    ...(style.audienceRating ? { audience: style.audienceRating } : {}),
    ...(language ? { script_language: language } : {}),
    ui_language: CREATIVE_UI_LANGUAGE,
  };
}

/**
 * The Style answers a Creative Bible depends on, as one comparable string: the genre and style
 * modules, format, orientation, durations and the script language. Two styles with the same key
 * need the same bible. Null when the style gets no bible.
 */
export function creativeBibleKey(style: ProjectStyle): string | null {
  const input = creativeDnaInputFromStyle(style);
  return input ? JSON.stringify(input) : null;
}
