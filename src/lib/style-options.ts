/**
 * The choices on the Style screen: the owner's genres and visual styles. Pure data with no server
 * imports. The `value` is a stable key (the draft damis resolve it through their module aliases;
 * `ownerGenreName` / `ownerStyleName` give the names the owner's dami files use); a typed
 * "Other" value is stored as the text itself.
 */

export interface StyleOption {
  value: string;
  label: string;
  description: string;
  /**
   * A real example picture for the option's tile (a path under `public/`). None exist yet; the
   * tile shows a neutral "Example image" placeholder until one is added here.
   */
  image?: string;
}

/** The owner's seven visual styles. The keys are stable; the labels are the owner's names. */
export const VISUAL_STYLES: readonly StyleOption[] = [
  {
    value: "realistic",
    label: "Realistic",
    description: "Real people and places, shot like a feature film.",
  },
  {
    value: "noir",
    label: "Noir",
    description: "Hard light, deep shadow and a visible source for every pool of light.",
  },
  {
    value: "futuristic",
    label: "Futuristic",
    description: "Sleek technology, neon and engineered worlds.",
  },
  {
    value: "horror-visual",
    label: "Horror Visual Style",
    description: "Dread in every frame: dark corners and uneasy light.",
  },
  {
    value: "3d-animation",
    label: "3D Animation",
    description: "Rendered characters and worlds, polished and dimensional.",
  },
  {
    value: "anime",
    label: "Anime",
    description: "Clean line art, cel shading and painted backgrounds.",
  },
  {
    value: "claymation",
    label: "Claymation",
    description: "Handmade clay figures and sets, moved frame by frame.",
  },
];

/** The owner's six genres. */
export const GENRES: readonly StyleOption[] = [
  { value: "drama", label: "Drama", description: "Character and conflict, played straight." },
  { value: "comedy", label: "Comedy", description: "Timing, surprise and warmth." },
  { value: "horror", label: "Horror", description: "Dread, then the thing itself." },
  { value: "thriller", label: "Thriller", description: "Tension that keeps tightening." },
  { value: "action", label: "Action", description: "Momentum, stakes and set pieces." },
  { value: "sci-fi", label: "Science Fiction", description: "Ideas, futures and strange worlds." },
];

/** Keys older projects stored, mapped to today's options. */
export const LEGACY_STYLE_KEYS: Readonly<Record<string, string>> = {
  "cinematic-live-action": "realistic",
  "2d-animation": "anime",
};
export const LEGACY_GENRE_KEYS: Readonly<Record<string, string>> = {
  documentary: "drama",
};

function ownerName(
  stored: string,
  options: readonly StyleOption[],
  legacy: Readonly<Record<string, string>>,
): string {
  const key = legacy[stored] ?? stored;
  return options.find((o) => o.value === key)?.label ?? stored;
}

/**
 * The genre as the owner's dami files name it ("Science Fiction"). Legacy keys map to today's
 * genres (documentary → Drama); a typed "Other" genre is passed through as written.
 */
export function ownerGenreName(stored: string): string {
  return ownerName(stored, GENRES, LEGACY_GENRE_KEYS);
}

/**
 * The visual style as the owner's dami files name it ("Horror Visual Style"). Legacy keys map to
 * today's styles (cinematic-live-action → Realistic, 2d-animation → Anime); a typed "Other" style
 * is passed through as written.
 */
export function ownerStyleName(stored: string): string {
  return ownerName(stored, VISUAL_STYLES, LEGACY_STYLE_KEYS);
}

export const FORMATS = [
  { value: "movie", label: "Movie" },
  { value: "series", label: "Series" },
] as const;

/** How the film is cut into generated video clips. `shot` is stored but not offered yet. */
export type BlockLength = "15" | "30" | "shot";

export const BLOCK_LENGTHS: readonly (StyleOption & { value: BlockLength })[] = [
  {
    value: "15",
    label: "15-Second Blocks",
    description: "Short clips with a quick rhythm: one or two moments each.",
  },
  {
    value: "30",
    label: "30-Second Blocks",
    description: "Longer clips with room for a whole scene beat.",
  },
  {
    value: "shot",
    label: "Shot by Shot",
    description: "Every shot is its own clip, for the most control.",
  },
];

/** The block lengths the Style screen offers today (shot by shot cannot run yet). */
export const OFFERED_BLOCK_LENGTHS: readonly BlockLength[] = ["15", "30"];

/** The block length a new project starts with. */
export const DEFAULT_BLOCK_LENGTH: BlockLength = "15";

/** The fixed block length in seconds a choice means, or null for shot by shot / unset. */
export function blockLengthSeconds(choice: BlockLength | undefined): 15 | 30 | null {
  return choice === "15" ? 15 : choice === "30" ? 30 : null;
}

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

/**
 * The duration and episode limits, shared by the style form and the server (the server may import
 * them from here; `@/lib` has no server code). Keep them in step with `@/server/projects` until it does.
 */
export const MIN_DURATION_SECONDS = 5;
export const MAX_DURATION_SECONDS = 4 * 60 * 60;
export const MAX_EPISODES = 100;

/** Number of episodes a series of this length makes: the total divided by the episode length, rounded up (the server rounds up too). */
export function episodeCount(totalSeconds: number, episodeSeconds: number): number {
  return Math.ceil(totalSeconds / episodeSeconds);
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

/** The option a stored value belongs to (legacy keys included), or "other" with the typed text. */
export function splitChoice(
  stored: string | undefined,
  options: readonly StyleOption[],
): { choice: string | null; other: string } {
  if (!stored) return { choice: null, other: "" };
  const key = LEGACY_STYLE_KEYS[stored] ?? LEGACY_GENRE_KEYS[stored] ?? stored;
  if (options.some((o) => o.value === key)) return { choice: key, other: "" };
  return { choice: OTHER_VALUE, other: stored };
}
