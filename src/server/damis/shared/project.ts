import type { ProjectStyle } from "@/server/db/schema";
import { resolveGenreModule, resolveStyleModule } from "../modules/registry";
import { formatSeconds, planDuration } from "./style";

/**
 * The per-project parameters, rendered for the user message (after the cached system prompt).
 * Deterministic: extras are sorted by key so the same project always renders the same bytes.
 */
export function renderProjectParameters(style: ProjectStyle): string {
  const plan = planDuration(style);
  const genreModule = resolveGenreModule(style.genre);
  const styleModule = resolveStyleModule(style.visualStyle);
  const lines = [
    "## Project parameters",
    `- Genre: ${style.genre} (module: ${genreModule.label})`,
    `- Visual style: ${style.visualStyle} (module: ${styleModule.label})`,
    `- Orientation: ${style.orientation === "portrait" ? "portrait 9:16" : "landscape 16:9"}`,
  ];
  if (plan.episodes !== null && plan.episodeSeconds !== null) {
    lines.push(
      `- Format: series of ${plan.episodes} episode${plan.episodes === 1 ? "" : "s"}, ${formatSeconds(plan.episodeSeconds)} each (${formatSeconds(plan.totalSeconds)} in total)`,
      `- Target length: about ${plan.targetWordsPerEpisode} words of screenplay per episode, about ${plan.targetWords} words in total`,
    );
  } else {
    lines.push(
      `- Format: single film, ${formatSeconds(plan.totalSeconds)} of screen time`,
      `- Target length: about ${plan.targetWords} words of screenplay`,
    );
  }
  const extras = Object.entries(style.extras ?? {})
    .filter(([, v]) => v.trim().length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [key, value] of extras) lines.push(`- ${key}: ${value}`);
  return lines.join("\n");
}
