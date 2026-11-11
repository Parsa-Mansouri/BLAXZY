import { stageHref } from "@/lib/stages";
import type { Project } from "@/server/projects";

/** What the dashboard needs about a project; plain values that cross the server/client line. */
export type ProjectSummary = {
  id: string;
  title: string;
  stage: string;
  updatedAt: string;
};

export type ProjectListPage = { items: ProjectSummary[]; nextCursor: string | null };

export function toSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    stage: project.stage,
    updatedAt: project.updatedAt.toISOString(),
  };
}

/** Where a project opens from the library: a finished film opens its finished screen. */
export function projectHref(project: Pick<ProjectSummary, "id" | "stage">): string {
  return project.stage === "done"
    ? `/projects/${project.id}/production/finished`
    : `/projects/${project.id}`;
}

/** The Script page of a project, offered beside Continue once the style is chosen. */
export function scriptHref(project: Pick<ProjectSummary, "id" | "stage">): string | null {
  return project.stage === "style" ? null : stageHref(project.id, "script");
}

export type StageTone = "done" | "waiting" | "working";

/** The status dot of a project in the library: finished, waiting for the user, or not started. */
export function stageTone(stage: string): StageTone {
  if (stage === "done") return "done";
  return stage === "style" ? "working" : "waiting";
}

/** What the project is waiting for, in a few plain words (no step counters). */
export function stageLine(project: Pick<ProjectSummary, "stage">): string {
  switch (project.stage) {
    case "done":
      return "Film finished";
    case "script":
      return "Script to write or review";
    case "pre_production":
      return "Sheets waiting for you";
    case "production":
      return "Clips to generate and review";
    default:
      return "Style not chosen yet";
  }
}
