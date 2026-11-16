/** Starting a script: from a brief, an idea or an upload, and from an approved outline. */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { review, scriptVersion } from "@/server/db/schema";
import { logProjectEvent, requestProjectName } from "@/server/projects";
import { FILE_PURPOSES, getOwnedFileInfo } from "@/server/storage";
import { ScriptInputError } from "./errors";
import {
  assertScriptStageOpen,
  BUSY_MESSAGE,
  enqueueForVersion,
  insertVersion,
  latestVersion,
  loadView,
  lockOwnedProject,
  projectScope,
} from "./internal";
import {
  approveOutlineSchema,
  parseInput,
  startFromBriefSchema,
  startFromIdeaSchema,
  startFromUploadSchema,
  uuidSchema,
} from "./schemas";
import { readNotes, type ScriptDamiNotes, type ScriptVersionView } from "./views";

/** What a new version starts from: the user's words (a brief or an idea) or an uploaded file. */
type StartValues =
  { source: "generated" | "enhanced"; brief: string } | { source: "uploaded"; fileId: string };

/**
 * A new pending version of the project's script from `values`, with its job (sent on the same
 * transaction) and a `script.started` event. Refused while the latest version is pending. The
 * caller has checked the input (and that `projectId` is a uuid).
 */
async function startVersion(
  projectId: string,
  userId: string,
  values: StartValues,
): Promise<ScriptVersionView | null> {
  const created = await getDb().transaction(async (tx) => {
    const owned = await lockOwnedProject(tx, projectId, userId);
    if (!owned) return null;
    assertScriptStageOpen(owned);
    const latest = await latestVersion(tx, projectId);
    if (latest?.status === "pending") throw new ScriptInputError(BUSY_MESSAGE);
    const row = await insertVersion(
      tx,
      { projectId, status: "pending", createdBy: userId, ...values },
      latest,
    );
    await logProjectEvent(tx, {
      projectId,
      userId,
      type: "script.started",
      payload:
        values.source === "uploaded"
          ? { versionId: row.id, source: values.source, fileId: values.fileId }
          : { versionId: row.id, source: values.source },
    });
    await enqueueForVersion(tx, row);
    // The first story names a project that has no title yet. An upload's text only exists once
    // the worker has read the file, so its job is queued then (completeScriptVersion).
    if (values.source !== "uploaded" && owned.titleSource === "placeholder") {
      await requestProjectName(tx, { projectId, scriptVersionId: row.id });
    }
    return row;
  });
  if (!created) return null;
  return loadView(created.id);
}

/** New generated version (pending) from the user's brief; enqueues `script.write`. */
export async function startFromBrief(input: {
  projectId: string;
  userId: string;
  brief: string;
}): Promise<ScriptVersionView | null> {
  const { projectId, userId, brief } = parseInput(startFromBriefSchema, input);
  if (!uuidSchema.safeParse(projectId).success) return null;
  return startVersion(projectId, userId, { source: "generated", brief });
}

/**
 * New enhanced version (pending) from the user's quick idea; enqueues `script.enhance`. The
 * Enhancer rewrites the idea as prose (kept as the version's content); review, acceptance,
 * detection and sectioning then work as for an upload.
 */
export async function startFromIdea(input: {
  projectId: string;
  userId: string;
  idea: string;
}): Promise<ScriptVersionView | null> {
  const { projectId, userId, idea } = parseInput(startFromIdeaSchema, input);
  if (!uuidSchema.safeParse(projectId).success) return null;
  return startVersion(projectId, userId, { source: "enhanced", brief: idea });
}

/** New uploaded version (pending) from a ready, owned file; enqueues `script.check`. */
export async function startFromUpload(input: {
  projectId: string;
  userId: string;
  fileId: string;
}): Promise<ScriptVersionView | null> {
  const { projectId, userId, fileId } = parseInput(startFromUploadSchema, input);
  if (!uuidSchema.safeParse(projectId).success) return null;
  const notUsable = new ScriptInputError("That file is not available. Upload it again.");
  if (!uuidSchema.safeParse(fileId).success) throw notUsable;
  const file = await getOwnedFileInfo(fileId, userId);
  if (
    !file ||
    file.status !== "ready" ||
    (file.projectId !== null && file.projectId !== projectId)
  ) {
    throw notUsable;
  }
  if (!(file.mimeType in FILE_PURPOSES.script_document.types)) {
    throw new ScriptInputError("Upload the script as a .txt, .md, .docx or .pdf file.");
  }
  return startVersion(projectId, userId, { source: "uploaded", fileId });
}

/**
 * Approves the outline of a long piece (a version in review that holds an outline and no text):
 * the outline version is superseded and the next version (generated, pending) is written
 * sequence by sequence from it, with the proposed additions the user approved.
 */
export async function approveOutline(input: {
  projectId: string;
  userId: string;
  versionId: string;
  approvedAdditions?: number[];
}): Promise<ScriptVersionView | null> {
  const parsed = parseInput(approveOutlineSchema, input);
  const { projectId, userId, versionId } = parsed;
  if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(versionId).success) {
    return null;
  }
  const created = await getDb().transaction(async (tx) => {
    const owned = await lockOwnedProject(tx, projectId, userId);
    if (!owned) return null;
    const latest = await latestVersion(tx, projectId);
    const [version] = await tx
      .select()
      .from(scriptVersion)
      .where(and(eq(scriptVersion.id, versionId), projectScope(projectId)))
      .limit(1);
    if (!version) return null;
    const notes = readNotes(version.damiNotes);
    if (version.status !== "in_review" || latest?.id !== version.id || !notes.outline) {
      throw new ScriptInputError("This outline is no longer waiting for review. Reload the page.");
    }
    const additions = [...new Set(parsed.approvedAdditions)].filter(
      (i) => i < (notes.outline?.proposed_additions.length ?? 0),
    );
    const now = new Date();
    await tx.insert(review).values({
      projectId,
      userId,
      subjectType: "script_version",
      subjectId: version.id,
      decision: "accepted",
      note: additions.length > 0 ? `Approved additions: ${additions.join(", ")}` : null,
      damiRunId: version.damiRunId,
    });
    await tx
      .update(scriptVersion)
      .set({ status: "superseded", decidedAt: now })
      .where(eq(scriptVersion.id, version.id));
    const next = await insertVersion(
      tx,
      {
        projectId,
        parentId: version.id,
        source: "generated",
        status: "pending",
        brief: version.brief,
        damiNotes: {
          outline: notes.outline,
          outlineApproved: true,
          approvedAdditions: additions,
          logline: notes.outline.logline,
        } satisfies ScriptDamiNotes,
        createdBy: userId,
      },
      latest,
    );
    await logProjectEvent(tx, {
      projectId,
      userId,
      type: "script.outline-approved",
      payload: {
        versionId: version.id,
        nextVersionId: next.id,
        approvedAdditions: additions,
      },
    });
    await enqueueForVersion(tx, next);
    return next;
  });
  if (!created) return null;
  return loadView(created.id);
}
