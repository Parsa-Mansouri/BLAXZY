import { GENRES, VISUAL_STYLES, episodeCount } from "@/lib/style-options";
import { formatDurationLong } from "@/ui/duration";

interface StyleLike {
  visualStyle: string;
  genre: string;
  format: "movie" | "series";
  totalDurationSeconds: number;
  episodeDurationSeconds?: number | null;
}

const labelOf = (value: string, options: readonly { value: string; label: string }[]) =>
  options.find((o) => o.value === value)?.label ?? value;

/** "Thriller · 3D Animation · Series, 6 episodes of 1 min" or "Drama · 2D and Anime · Movie, 2 min". */
export function styleSummary(style: StyleLike): string {
  const length =
    style.format === "series" && style.episodeDurationSeconds
      ? (() => {
          const count = episodeCount(style.totalDurationSeconds, style.episodeDurationSeconds);
          return `Series, ${count} ${count === 1 ? "episode" : "episodes"} of ${formatDurationLong(style.episodeDurationSeconds)}`;
        })()
      : `Movie, ${formatDurationLong(style.totalDurationSeconds)}`;
  return [labelOf(style.genre, GENRES), labelOf(style.visualStyle, VISUAL_STYLES), length].join(
    " · ",
  );
}
