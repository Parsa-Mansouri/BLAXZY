"use server";

import { revalidatePath } from "next/cache";
import { archiveProject, createProject, listProjects, renameProject } from "@/server/projects";
import { userAction, type ActionFailure } from "../_lib/action";
import { toSummary, type ProjectListPage, type ProjectSummary } from "./_lib/summary";

const NOT_FOUND = "This project no longer exists. It may have been archived. Reload the page.";

/** Starts a project with no title: Claude names it from the first story (`project.name`). */
export async function createProjectAction(): Promise<{ ok: true; id: string } | ActionFailure> {
  return userAction("mutate", "dashboard.createProject", async (user) => {
    const created = await createProject({ ownerId: user.id });
    revalidatePath("/dashboard");
    return { ok: true, id: created.id };
  });
}

export async function renameProjectAction(
  projectId: string,
  title: string,
): Promise<{ ok: true; project: ProjectSummary } | ActionFailure> {
  return userAction("mutate", "dashboard.renameProject", async (user) => {
    const updated = await renameProject({ projectId, ownerId: user.id, title });
    if (!updated) return { ok: false, error: NOT_FOUND };
    revalidatePath("/dashboard");
    return { ok: true, project: toSummary(updated) };
  });
}

export async function archiveProjectAction(
  projectId: string,
): Promise<{ ok: true } | ActionFailure> {
  return userAction("mutate", "dashboard.archiveProject", async (user) => {
    const archived = await archiveProject({ projectId, ownerId: user.id });
    if (!archived) return { ok: false, error: NOT_FOUND };
    revalidatePath("/dashboard");
    return { ok: true };
  });
}

export async function loadMoreProjectsAction(
  cursor: string,
): Promise<({ ok: true } & ProjectListPage) | ActionFailure> {
  return userAction("read", "dashboard.loadMoreProjects", async (user) => {
    const page = await listProjects({ ownerId: user.id, cursor });
    return { ok: true, items: page.items.map(toSummary), nextCursor: page.nextCursor };
  });
}
