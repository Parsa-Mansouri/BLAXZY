import type { ProjectStyle, StyleReference } from "@/server/db/schema";
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
    ...renderStyleReferences(style),
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

/**
 * Lines for the references behind a look or genre the user described themselves. The names go
 * in as given; the description is already part of the style value. Images are counted (a text
 * prompt cannot carry them). Empty when there are none, so older projects render as before.
 */
export function renderStyleReferences(style: ProjectStyle): string[] {
  const lines: string[] = [];
  const parts: [string, StyleReference | undefined][] = [
    ["Visual style", style.references?.visualStyle],
    ["Genre", style.references?.genre],
  ];
  for (const [label, ref] of parts) {
    if (!ref) continue;
    if (ref.titles.length > 0) {
      lines.push(`- ${label} references (films or shows): ${ref.titles.join("; ")}`);
    }
    if (ref.fileIds.length > 0) {
      const n = ref.fileIds.length;
      lines.push(`- ${label} reference images: ${n} supplied by the user`);
    }
  }
  return lines;
}
