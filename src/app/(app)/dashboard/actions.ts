"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import {
  archiveProject,
  createProject,
  listProjects,
  ProjectInputError,
  renameProject,
} from "@/server/projects";
import { toSummary, type ProjectListPage, type ProjectSummary } from "./_lib/summary";

type Failure = { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong on our side. Try again in a moment.";
const NOT_FOUND = "We could not find that project. It may have been archived. Reload the page.";

function failure(error: unknown): Failure {
  if (error instanceof ProjectInputError) return { ok: false, error: error.message };
  return { ok: false, error: GENERIC_ERROR };
}

export async function createProjectAction(
  title: string,
): Promise<{ ok: true; id: string } | Failure> {
  const user = await requireUser();
  try {
    const created = await createProject({ ownerId: user.id, title });
    revalidatePath("/dashboard");
    return { ok: true, id: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function renameProjectAction(
  projectId: string,
  title: string,
): Promise<{ ok: true; project: ProjectSummary } | Failure> {
  const user = await requireUser();
  try {
    const updated = await renameProject({ projectId, ownerId: user.id, title });
    if (!updated) return { ok: false, error: NOT_FOUND };
    revalidatePath("/dashboard");
    return { ok: true, project: toSummary(updated) };
  } catch (error) {
    return failure(error);
  }
}

export async function archiveProjectAction(projectId: string): Promise<{ ok: true } | Failure> {
  const user = await requireUser();
  try {
    const archived = await archiveProject({ projectId, ownerId: user.id });
    if (!archived) return { ok: false, error: NOT_FOUND };
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function loadMoreProjectsAction(
  cursor: string,
): Promise<({ ok: true } & ProjectListPage) | Failure> {
  const user = await requireUser();
  try {
    const page = await listProjects({ ownerId: user.id, cursor });
    return { ok: true, items: page.items.map(toSummary), nextCursor: page.nextCursor };
  } catch (error) {
    return failure(error);
  }
}
