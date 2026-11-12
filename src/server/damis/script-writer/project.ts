import { ownerGenreName, ownerStyleName } from "@/lib/style-options";
import type { ProjectStyle } from "@/server/db/schema";
import { durationBudget, SINGLE_CALL_MAX_SECONDS } from "../shared/duration";
import type { WriterProject } from "./schema";

/** One generate call's target: the film, or one episode of a series. */
export function singleCallTarget(style: ProjectStyle): number {
  return style.format === "series" && style.episodeDurationSeconds
    ? style.episodeDurationSeconds
    : style.totalDurationSeconds;
}

/** Episodes a series is written in (each its own generate call). */
export function episodeCount(style: ProjectStyle): number {
  if (style.format !== "series" || !style.episodeDurationSeconds) return 1;
  return Math.max(1, Math.ceil(style.totalDurationSeconds / style.episodeDurationSeconds));
}

/** A movie over 15 minutes goes through the long pipeline (outline → segments). */
export function needsOutline(style: ProjectStyle): boolean {
  return style.format !== "series" && style.totalDurationSeconds > SINGLE_CALL_MAX_SECONDS;
}

/**
 * The writer's `<project>` block for a target. Only what the owner's template asks for: the
 * genre and style select modules, and format is film or series_episode. Orientation, art details
 * and models are never sent (the owner: they belong to shot design).
 */
export function writerProject(
  style: ProjectStyle,
  targetSeconds: number,
  options: { creativeExpansion?: boolean } = {},
): WriterProject {
  const genre = ownerGenreName(style.genre);
  const budget = durationBudget(targetSeconds, genre);
  const notes = [
    style.eraSetting ? `Era and setting: ${style.eraSetting}` : null,
    ...Object.entries(style.extras ?? {})
      .filter(([key]) => key !== "language")
      .map(([key, value]) => `${key}: ${value}`),
  ].filter((n): n is string => n !== null);
  const language = style.extras?.language;
  return {
    genre,
    visualStyle: ownerStyleName(style.visualStyle),
    format: style.format === "series" ? "series_episode" : "film",
    targetDurationSeconds: budget.targetSeconds,
    budget: {
      sceneCountRange: budget.sceneCountRange,
      dialogueWordBudget: budget.dialogueWordBudget,
      actionBeatBudget: budget.actionBeatBudget,
      toleranceSeconds: budget.toleranceSeconds,
    },
    ...(language ? { outputLanguage: language.slice(0, 40) } : {}),
    ...(style.audienceRating ? { audienceRating: style.audienceRating } : {}),
    creativeExpansion: options.creativeExpansion ?? false,
    ...(notes.length > 0 ? { projectNotes: notes.join("\n").slice(0, 4000) } : {}),
  };
}
