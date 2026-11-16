import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { PLACEHOLDER_TITLE, project } from "@/server/db/schema";
import { decodeTimestampCursor, encodeTimestampCursor } from "./cursor";
import { logProjectEvent } from "./events";
import { findOwnedProject } from "./ownership";
import {
  archiveProjectSchema,
  createProjectSchema,
  listProjectsSchema,
  parseInput,
  ProjectInputError,
  renameProjectSchema,
  uuidSchema,
} from "./schemas";

export type Project = typeof project.$inferSelect;

export type ProjectPage = { items: Project[]; nextCursor: string | null };

/** Without a title (or with a blank one) the project is "Untitled project" until it is named. */
export type CreateProjectInput = { ownerId: string; title?: string };
export type ListProjectsInput = { ownerId: string; limit?: number; cursor?: string | null };
export type RenameProjectInput = { projectId: string; ownerId: string; title: string };
export type ArchiveProjectInput = { projectId: string; ownerId: string };

const notArchived = isNull(project.archivedAt);

/** Microsecond-precise ISO text of `updated_at` (JS dates would round and repeat rows). */
const updatedAtText = sql<string>`to_char(${project.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function decodeCursor(cursor: string): { updatedAt: string; id: string } {
  const decoded = decodeTimestampCursor(cursor);
  if (!decoded) throw new ProjectInputError("That page link is no longer valid. Reload the list.");
  return { updatedAt: decoded.timestamp, id: decoded.id };
}

/**
 * Creates a Wizard project at the Style stage and logs `project.created`, in one transaction. A
 * given title is the user's (`title_source` `user`); without one the title is the placeholder
 * and the first story the user gives names the project (`project.name`).
 */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  const { ownerId, title: given } = parseInput(createProjectSchema, input);
  const named = given !== undefined && given.length > 0;
  const title = named ? given : PLACEHOLDER_TITLE;
  return getDb().transaction(async (tx) => {
    const [created] = await tx
      .insert(project)
      .values({
        ownerId,
        title,
        titleSource: named ? "user" : "placeholder",
        mode: "wizard",
        stage: "style",
      })
      .returning();
    if (!created) throw new Error("Project insert returned no row.");
    await logProjectEvent(tx, {
      projectId: created.id,
      userId: ownerId,
      type: "project.created",
      payload: { title, titleSource: created.titleSource },
    });
    return created;
  });
}

/** The owner's non-archived projects, newest `updatedAt` first, with keyset pagination. */
export async function listProjects(input: ListProjectsInput): Promise<ProjectPage> {
  const { ownerId, limit, cursor } = parseInput(listProjectsSchema, input);
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await getDb()
    .select({ row: project, cursorTs: updatedAtText })
    .from(project)
    .where(
      and(
        eq(project.ownerId, ownerId),
        notArchived,
        after
          ? sql`(${project.updatedAt}, ${project.id}) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(project.updatedAt), desc(project.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const hasMore = rows.length > limit && last !== undefined;
  return {
    items: page.map((r) => r.row),
    nextCursor: hasMore ? encodeTimestampCursor(last.cursorTs, last.row.id) : null,
  };
}

/** The project, or null when it does not exist, is archived or belongs to someone else. */
export async function getProjectForUser(
  projectId: string,
  userId: string,
): Promise<Project | null> {
  return findOwnedProject(getDb(), projectId, userId);
}

/** Renames an owned project. Returns null (nothing changed) when it is not the user's. */
export async function renameProject(input: RenameProjectInput): Promise<Project | null> {
  const { projectId, ownerId, title } = parseInput(renameProjectSchema, input);
  if (!uuidSchema.safeParse(projectId).success) return null;
  return getDb().transaction(async (tx) => {
    const existing = await findOwnedProject(tx, projectId, ownerId, { lock: "update" });
    if (!existing) return null;
    const [updated] = await tx
      .update(project)
      .set({ title, titleSource: "user" })
      .where(eq(project.id, projectId))
      .returning();
    await logProjectEvent(tx, {
      projectId,
      userId: ownerId,
      type: "project.renamed",
      payload: { from: existing.title, to: title },
    });
    return updated ?? null;
  });
}

/** Soft-deletes an owned project (sets `archivedAt`). Returns false when it is not the user's. */
export async function archiveProject(input: ArchiveProjectInput): Promise<boolean> {
  const { projectId, ownerId } = parseInput(archiveProjectSchema, input);
  if (!uuidSchema.safeParse(projectId).success) return false;
  return getDb().transaction(async (tx) => {
    const archived = await tx
      .update(project)
      .set({ archivedAt: new Date() })
      .where(and(eq(project.id, projectId), eq(project.ownerId, ownerId), notArchived))
      .returning({ id: project.id });
    if (archived.length === 0) return false;
    await logProjectEvent(tx, {
      projectId,
      userId: ownerId,
      type: "project.archived",
      payload: null,
    });
    return true;
  });
}
