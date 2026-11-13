/**
 * The one rule for how many episodes a series has (docs/M1_CONTRACTS.md: `ceil(total /
 * perEpisode)`): episodes cover the whole runtime, so a remainder makes one more (shorter)
 * episode. Pure, no imports: the client copy and the damis' duration plan should use this rule.
 */

/** Episodes of a series of `totalSeconds` cut into `episodeSeconds` episodes (at least 1). */
export function episodeCount(totalSeconds: number, episodeSeconds: number): number {
  if (!(episodeSeconds > 0) || !(totalSeconds > 0)) return 1;
  return Math.max(1, Math.ceil(totalSeconds / episodeSeconds));
}

/** Episode rows a style needs: a movie has one; a series `episodeCount(total, perEpisode)`. */
export function episodeCountOf(style: {
  format: string;
  totalDurationSeconds: number;
  episodeDurationSeconds?: number;
}): number {
  return style.format === "series" && style.episodeDurationSeconds !== undefined
    ? episodeCount(style.totalDurationSeconds, style.episodeDurationSeconds)
    : 1;
}
