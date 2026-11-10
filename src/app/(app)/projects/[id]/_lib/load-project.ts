import { notFound } from "next/navigation";
import { cache } from "react";
import { requireUser } from "@/server/auth";
import { getProjectForUser } from "@/server/projects";

/** The signed-in user's project, or a 404. Cached per request so layout and page share it. */
export const loadProject = cache(async (projectId: string) => {
  const user = await requireUser();
  const project = await getProjectForUser(projectId, user.id);
  if (!project) notFound();
  return project;
});
