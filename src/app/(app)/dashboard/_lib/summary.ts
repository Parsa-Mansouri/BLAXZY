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
