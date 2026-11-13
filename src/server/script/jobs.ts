/**
 * The script service's surface for job handlers (worker only): load what a job needs, and write
 * its result with conditional updates so a duplicate or stale run cannot overwrite newer state.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { StoredScreenplay, SubmitOutline } from "@/server/damis";
import { getDb } from "@/server/db/client";
import {
  project,
  review,
  scriptVersion,
  type ProjectStyle,
  type ReviewComment,
  type ReviewFixRequest,
} from "@/server/db/schema";
import { enqueue, scriptWriteSegment } from "@/server/jobs";
import { logProjectEvent } from "@/server/projects";
import { getOwnedFileInfo, type FileInfo } from "@/server/storage";
import { uuidSchema } from "./schemas";
import {
  readNotes,
  type ScriptDamiNotes,
  type ScriptVersionRow,
  type SegmentProgress,
} from "./views";

export type ScriptJobContext = {
  version: ScriptVersionRow;
  project: { id: string; ownerId: string; style: ProjectStyle | null };
  /** Whether this is the project's latest version (handlers skip stale ones). */
  isLatest: boolean;
  /** Revised versions: the rejected parent and the review that rejected it. */
  parent: ScriptVersionRow | null;
  review: {
    issueCodes: string[];
    fixRequests: ReviewFixRequest[];
    note: string | null;
    comments: ReviewComment[];
  } | null;
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
    rejection = r
      ? {
          issueCodes: r.issueCodes,
          fixRequests: r.fixRequests,
          note: r.note,
          comments: r.comments,
        }
      : null;
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
  /** Null when no dami produced the text (an enhanced version that kept the user's own words). */
  damiRunId: string | null;
  notes: ScriptDamiNotes;
  /** The Script Writer's structured screenplay, when it wrote one. */
  screenplay?: StoredScreenplay | null;
}): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(scriptVersion)
      .where(and(eq(scriptVersion.id, input.versionId), eq(scriptVersion.status, "pending")))
      .for("update");
    if (!row) return false;
    const { segmentProgress: _done, ...previous } = readNotes(row.damiNotes);
    void _done;
    await tx
      .update(scriptVersion)
      .set({
        status: "in_review",
        content: input.content.replace(/\r\n?/g, "\n"),
        screenplay: input.screenplay ?? null,
        ...(input.damiRunId ? { damiRunId: input.damiRunId } : {}),
        damiNotes: { ...previous, ...input.notes, failure: null },
      })
      .where(eq(scriptVersion.id, input.versionId));
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "script.ready",
      payload: { versionId: row.id, source: row.source },
    });
    return true;
  });
}

/**
 * Long pieces: pending → in_review with the outline to approve (no script text yet). Returns
 * false when another run already finished the version.
 */
export async function completeOutline(input: {
  versionId: string;
  outline: SubmitOutline;
  damiRunId: string;
}): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(scriptVersion)
      .where(and(eq(scriptVersion.id, input.versionId), eq(scriptVersion.status, "pending")))
      .for("update");
    if (!row) return false;
    const notes: ScriptDamiNotes = {
      ...readNotes(row.damiNotes),
      outline: input.outline,
      outlineApproved: false,
      logline: input.outline.logline,
      warnings: input.outline.warnings,
      failure: null,
    };
    await tx
      .update(scriptVersion)
      .set({ status: "in_review", damiRunId: input.damiRunId, damiNotes: notes })
      .where(eq(scriptVersion.id, input.versionId));
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "script.outline-ready",
      payload: { versionId: row.id },
    });
    return true;
  });
}

/**
 * Stores the progress of a version written sequence by sequence, only while the version is
 * pending and its stored progress is still at `expectedIndex` (a duplicate run changes nothing),
 * and queues the job of the next sequence (`progress.nextIndex`) in the same transaction, so the
 * progress is never stored without its continuation.
 */
export async function storeSegmentProgress(input: {
  versionId: string;
  expectedIndex: number;
  progress: SegmentProgress;
}): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(scriptVersion)
      .where(and(eq(scriptVersion.id, input.versionId), eq(scriptVersion.status, "pending")))
      .for("update");
    if (!row) return false;
    const notes = readNotes(row.damiNotes);
    if ((notes.segmentProgress?.nextIndex ?? 0) !== input.expectedIndex) return false;
    await tx
      .update(scriptVersion)
      .set({ damiNotes: { ...notes, segmentProgress: input.progress } })
      .where(eq(scriptVersion.id, input.versionId));
    await enqueue(
      scriptWriteSegment,
      { scriptVersionId: input.versionId, segmentIndex: input.progress.nextIndex },
      { tx },
    );
    return true;
  });
}

export { markFailed as failScriptVersion } from "./service";
