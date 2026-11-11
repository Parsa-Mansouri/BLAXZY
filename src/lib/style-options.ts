/**
 * The choices on the Style screen. Pure data with no server imports. The `value` of a visual
 * style or genre is the key of the matching dami module, so the writers get the right guidance;
 * a typed "Other" value is stored as the text itself.
 */

export interface StyleOption {
  value: string;
  label: string;
  description: string;
}

export const VISUAL_STYLES: readonly StyleOption[] = [
  {
    value: "cinematic-live-action",
    label: "Cinematic Live Action",
    description: "Real people and places, shot like a feature film.",
  },
  {
    value: "3d-animation",
    label: "3D Animation",
    description: "Rendered characters and worlds, polished and dimensional.",
  },
  {
    value: "2d-animation",
    label: "2D and Anime",
    description: "Hand-drawn lines and flat colour, in motion.",
  },
];

export const GENRES: readonly StyleOption[] = [
  { value: "drama", label: "Drama", description: "Character and conflict, played straight." },
  { value: "comedy", label: "Comedy", description: "Timing, surprise and warmth." },
  { value: "thriller", label: "Thriller", description: "Tension that keeps tightening." },
  { value: "horror", label: "Horror", description: "Dread, then the thing itself." },
  { value: "sci-fi", label: "Science Fiction", description: "Ideas, futures and strange worlds." },
  { value: "documentary", label: "Documentary", description: "Real subjects, told as they are." },
];

export const FORMATS = [
  { value: "movie", label: "Movie" },
  { value: "series", label: "Series" },
] as const;

export const ORIENTATION_OPTIONS = [
  { value: "landscape", label: "Landscape", description: "16:9" },
  { value: "portrait", label: "Portrait", description: "9:16" },
] as const;

/** Value of the "Other" choice in the visual style and genre pickers. */
export const OTHER_VALUE = "__other__";

/** Quick duration presets, in seconds. */
export const DURATION_PRESETS = [
  { seconds: 30, label: "30 s" },
  { seconds: 60, label: "1 min" },
  { seconds: 180, label: "3 min" },
  { seconds: 600, label: "10 min" },
] as const;

/** Mirrors the server rules in `@/server/projects` (kept here because the client cannot import it). */
export const MIN_DURATION_SECONDS = 5;
export const MAX_DURATION_SECONDS = 4 * 60 * 60;
export const MAX_EPISODES = 100;

/** Number of episodes a series of this length makes (the server rounds up too). */
export function episodeCount(total: number, perEpisode: number): number {
  return Math.ceil(total / perEpisode);
}

/** Error for a duration field, mirroring the server rules; `null` when the value is fine. */
export function durationError(
  field: "total" | "episode",
  seconds: number | null,
  total: number | null,
): string | null {
  const noun = field === "total" ? "total" : "episode";
  if (seconds === null || seconds === 0) return `Enter the ${noun} duration.`;
  if (seconds < MIN_DURATION_SECONDS) return `Make it at least ${MIN_DURATION_SECONDS} seconds.`;
  if (seconds > MAX_DURATION_SECONDS) return "Make it 4 hours or shorter.";
  if (field === "episode" && total !== null && total >= MIN_DURATION_SECONDS) {
    if (seconds > total) {
      return "An episode cannot be longer than the whole series. Shorten the episode or lengthen the series.";
    }
    if (episodeCount(total, seconds) > MAX_EPISODES) {
      return `That would make more than ${MAX_EPISODES} episodes. Make the episodes longer.`;
    }
  }
  return null;
}

/** The option a stored value belongs to, or "other" with the typed text. */
export function splitChoice(
  stored: string | undefined,
  options: readonly StyleOption[],
): { choice: string | null; other: string } {
  if (!stored) return { choice: null, other: "" };
  if (options.some((o) => o.value === stored)) return { choice: stored, other: "" };
  return { choice: OTHER_VALUE, other: stored };
}
