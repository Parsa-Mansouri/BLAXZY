/**
 * The script service's surface for job handlers (worker only): load what a job needs, and write
 * its result with conditional updates so a duplicate or stale run cannot overwrite newer state.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  project,
  projectEvent,
  review,
  scriptVersion,
  type ProjectStyle,
  type ReviewComment,
} from "@/server/db/schema";
import { getOwnedFileInfo, type FileInfo } from "@/server/storage";
import { uuidSchema } from "./schemas";
import { readNotes, type ScriptDamiNotes, type ScriptVersionRow } from "./views";

export type ScriptJobContext = {
  version: ScriptVersionRow;
  project: { id: string; ownerId: string; style: ProjectStyle | null };
  /** Whether this is the project's latest version (handlers skip stale ones). */
  isLatest: boolean;
  /** Revised versions: the rejected parent and the review that rejected it. */
  parent: ScriptVersionRow | null;
  review: { issueCodes: string[]; note: string | null; comments: ReviewComment[] } | null;
  /** Uploaded versions: the source document. */
  file: FileInfo | null;
};

/** Everything a script job needs, or null when the version or its project is gone or archived. */
export async function loadScriptJob(versionId: string): Promise<ScriptJobContext | null> {
  if (!uuidSchema.safeParse(versionId).success) return null;
  const db = getDb();
  const [row] = await db
    .select({ version: scriptVersion, project })
    .from(scriptVersion)
    .innerJoin(project, eq(project.id, scriptVersion.projectId))
    .where(and(eq(scriptVersion.id, versionId), isNull(project.archivedAt)))
    .limit(1);
  if (!row) return null;
  const { version } = row;
  const [latest] = await db
    .select({ id: scriptVersion.id })
    .from(scriptVersion)
    .where(
      and(
        eq(scriptVersion.projectId, version.projectId),
        version.episodeId === null
          ? isNull(scriptVersion.episodeId)
          : eq(scriptVersion.episodeId, version.episodeId),
      ),
    )
    .orderBy(desc(scriptVersion.versionNumber))
    .limit(1);

  let parent: ScriptVersionRow | null = null;
  let rejection: ScriptJobContext["review"] = null;
  if (version.parentId) {
    const [p] = await db
      .select()
      .from(scriptVersion)
      .where(eq(scriptVersion.id, version.parentId))
      .limit(1);
    parent = p ?? null;
    const [r] = await db
      .select()
      .from(review)
      .where(
        and(
          eq(review.subjectType, "script_version"),
          eq(review.subjectId, version.parentId),
          eq(review.decision, "rejected"),
        ),
      )
      .orderBy(desc(review.createdAt))
      .limit(1);
    rejection = r ? { issueCodes: r.issueCodes, note: r.note, comments: r.comments } : null;
  }
  const file = version.fileId ? await getOwnedFileInfo(version.fileId, row.project.ownerId) : null;
  return {
    version,
    project: { id: row.project.id, ownerId: row.project.ownerId, style: row.project.style },
    isLatest: latest?.id === version.id,
    parent,
    review: rejection,
    file,
  };
}

/**
 * pending → in_review with the produced content and notes. Returns false (and changes nothing)
 * when another run already finished it.
 */
export async function completeScriptVersion(input: {
  versionId: string;
  content: string;
  damiRunId: string;
  notes: ScriptDamiNotes;
}): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(scriptVersion)
      .where(and(eq(scriptVersion.id, input.versionId), eq(scriptVersion.status, "pending")))
      .for("update");
    if (!row) return false;
    await tx
      .update(scriptVersion)
      .set({
        status: "in_review",
        content: input.content.replace(/\r\n?/g, "\n"),
        damiRunId: input.damiRunId,
        damiNotes: { ...readNotes(row.damiNotes), ...input.notes, failure: null },
      })
      .where(eq(scriptVersion.id, input.versionId));
    await tx.insert(projectEvent).values({
      projectId: row.projectId,
      userId: null,
      type: "script.ready",
      payload: { versionId: row.id, source: row.source },
    });
    return true;
  });
}

export { markFailed as failScriptVersion } from "./service";
