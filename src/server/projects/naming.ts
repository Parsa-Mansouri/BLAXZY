/**
 * Automatic project names. A project created without a title is "Untitled project"
 * (`title_source` `placeholder`); the first story the user gives (a brief, an idea or an uploaded
 * script) queues `project.name`, the worker runs the Project Namer dami and `applyAutoName` sets
 * the title once, only while it is still the placeholder. A rename by the user (`user`) always
 * wins, whenever it happens, and a named project is never named again.
 */
import { and, eq } from "drizzle-orm";
import { storyExcerpt, type ProjectNamerInput } from "@/server/damis";
import { getDb, type DbTx } from "@/server/db/client";
import { project, scriptVersion } from "@/server/db/schema";
import { enqueue, projectName } from "@/server/jobs";
import { logProjectEvent } from "./events";
import { uuidSchema } from "./schemas";

/**
 * Queues the naming of the project when its title is still the placeholder, on the caller's
 * transaction (so the story and its job are committed together). Does nothing otherwise.
 * Returns whether a job was queued.
 */
export async function requestProjectName(
  tx: DbTx,
  input: { projectId: string; scriptVersionId: string },
): Promise<boolean> {
  const [row] = await tx
    .select({ titleSource: project.titleSource })
    .from(project)
    .where(eq(project.id, input.projectId))
    .limit(1);
  if (row?.titleSource !== "placeholder") return false;
  await enqueue(projectName, input, { tx });
  return true;
}

export type ProjectNameJob = {
  projectId: string;
  ownerId: string;
  /** The namer's input, or null when there is no story text to read. */
  input: ProjectNamerInput | null;
};

/**
 * What the naming job needs: null unless the project exists, is not archived and still has the
 * placeholder title (the job is then done). The story is the version's text, else its brief.
 */
export async function loadProjectNameJob(
  projectId: string,
  scriptVersionId: string,
): Promise<ProjectNameJob | null> {
  if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(scriptVersionId).success) {
    return null;
  }
  const db = getDb();
  const [row] = await db
    .select({
      id: project.id,
      ownerId: project.ownerId,
      titleSource: project.titleSource,
      archivedAt: project.archivedAt,
      style: project.style,
    })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row || row.archivedAt !== null || row.titleSource !== "placeholder") return null;
  const [version] = await db
    .select({ content: scriptVersion.content, brief: scriptVersion.brief })
    .from(scriptVersion)
    .where(and(eq(scriptVersion.id, scriptVersionId), eq(scriptVersion.projectId, projectId)))
    .limit(1);
  const story = (version?.content?.trim() || version?.brief?.trim() || "").trim();
  return {
    projectId: row.id,
    ownerId: row.ownerId,
    input: story
      ? {
          genre: row.style?.genre ?? null,
          visualStyle: row.style?.visualStyle ?? null,
          format: row.style?.format ?? null,
          story: storyExcerpt(story),
        }
      : null,
  };
}

/**
 * Sets the automatic title, only while the title is still the placeholder (a rename that landed
 * meanwhile wins, and so does a name that already landed). Returns whether it was applied.
 */
export async function applyAutoName(input: {
  projectId: string;
  title: string;
  damiRunId: string | null;
}): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(project)
      .set({ title: input.title, titleSource: "auto" })
      .where(and(eq(project.id, input.projectId), eq(project.titleSource, "placeholder")))
      .returning({ id: project.id });
    if (!updated) return false;
    await logProjectEvent(tx, {
      projectId: input.projectId,
      userId: null,
      type: "project.named",
      payload: { title: input.title, damiRunId: input.damiRunId },
    });
    return true;
  });
}
