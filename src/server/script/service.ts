/**
 * The Script stage: script versions, reviews and the jobs that produce them. Every function takes
 * the acting user and returns null when the project is missing, archived or not theirs. Jobs are
 * enqueued only after the transaction that creates their version has committed.
 */
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { setSectioningState } from "@/server/blocks";
import { getDb, type DbTx } from "@/server/db/client";
import {
  damiRun,
  project,
  projectEvent,
  review,
  scriptVersion,
  WIZARD_STAGES,
  type ReviewComment,
  type ScriptSource,
  type WizardStage,
} from "@/server/db/schema";
import {
  enqueue,
  scriptCheck,
  scriptDetectAssets,
  scriptRevise,
  scriptWrite,
  type JobDefinition,
} from "@/server/jobs";
import { advanceStage, canOpenStage } from "@/server/projects";
import { FILE_PURPOSES, getOwnedFileInfo } from "@/server/storage";
import { ScriptInputError } from "./errors";
import { containsQuoteInScript } from "./quotes";
import {
  editAcceptedSchema,
  MAX_LISTED_VERSIONS,
  parseInput,
  retrySchema,
  startFromBriefSchema,
  startFromUploadSchema,
  submitReviewSchema,
  uuidSchema,
} from "./schemas";
import {
  readNotes,
  toView,
  type ScriptDamiNotes,
  type ScriptVersionRow,
  type ScriptVersionSummary,
  type ScriptVersionView,
} from "./views";

export type ScriptState = {
  /** The latest version. */
  current: ScriptVersionView | null;
  /** The accepted version, if any. */
  accepted: ScriptVersionView | null;
  /** The most recent versions, newest first (at most MAX_LISTED_VERSIONS). */
  versions: ScriptVersionSummary[];
  /** A job for the latest version is in flight (it is pending). */
  busy: boolean;
};

const BUSY_MESSAGE = "A script is still being prepared. Wait for it to finish, then try again.";
const ENQUEUE_FAILURE = "This step could not start. Try again in a moment.";

/** The job that produces a version of each source. */
const JOB_FOR_SOURCE: Record<ScriptSource, JobDefinition<typeof scriptWrite.payload> | null> = {
  generated: scriptWrite,
  uploaded: scriptCheck,
  revised: scriptRevise,
  edited: null,
};

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const projectScope = (projectId: string) =>
  and(eq(scriptVersion.projectId, projectId), isNull(scriptVersion.episodeId));

async function lockOwnedProject(tx: DbTx, projectId: string, userId: string) {
  const [row] = await tx
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .for("update");
  return row ?? null;
}

async function ownedProject(projectId: string, userId: string) {
  if (!uuidSchema.safeParse(projectId).success) return null;
  const [row] = await getDb()
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .limit(1);
  return row ?? null;
}

function assertScriptStageOpen(row: { stage: string; style: unknown }): void {
  const wizardStage = (WIZARD_STAGES as readonly string[]).includes(row.stage);
  if (
    row.style === null ||
    (wizardStage && !canOpenStage({ stage: row.stage }, "script" satisfies WizardStage))
  ) {
    throw new ScriptInputError("Choose the project's style before working on the script.");
  }
}

async function latestVersion(tx: DbTx, projectId: string): Promise<ScriptVersionRow | null> {
  const [row] = await tx
    .select()
    .from(scriptVersion)
    .where(projectScope(projectId))
    .orderBy(desc(scriptVersion.versionNumber))
    .limit(1);
  return row ?? null;
}

async function insertVersion(
  tx: DbTx,
  values: Omit<typeof scriptVersion.$inferInsert, "versionNumber">,
  latest: ScriptVersionRow | null,
): Promise<ScriptVersionRow> {
  const [row] = await tx
    .insert(scriptVersion)
    .values({ ...values, versionNumber: (latest?.versionNumber ?? 0) + 1 })
    .returning();
  if (!row) throw new Error("script_version insert returned no row");
  return row;
}

async function logEvent(
  tx: DbTx,
  projectId: string,
  userId: string | null,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(projectEvent).values({ projectId, userId, type, payload });
}

/** The version with its producing run's model, or null. */
async function loadView(versionId: string): Promise<ScriptVersionView | null> {
  const [row] = await getDb()
    .select({ version: scriptVersion, model: damiRun.model })
    .from(scriptVersion)
    .leftJoin(damiRun, eq(damiRun.id, scriptVersion.damiRunId))
    .where(eq(scriptVersion.id, versionId))
    .limit(1);
  return row ? toView(row.version, row.model) : null;
}

/**
 * Enqueues the version's job after commit. If the queue is unreachable the version is marked
 * failed (so the user can retry) instead of staying pending with no job.
 */
async function enqueueForVersion(row: ScriptVersionRow): Promise<void> {
  const job = JOB_FOR_SOURCE[row.source];
  if (!job) return;
  try {
    await enqueue(job, { scriptVersionId: row.id });
  } catch (error) {
    console.error(`[script] could not enqueue ${job.name} for ${row.id}:`, error);
    await markFailed(row.id, ENQUEUE_FAILURE);
  }
}

async function enqueueDetection(projectId: string, versionId: string): Promise<void> {
  try {
    await enqueue(scriptDetectAssets, { scriptVersionId: versionId });
  } catch (error) {
    console.error(`[script] could not enqueue asset detection for ${versionId}:`, error);
    await setSectioningState({
      projectId,
      state: "failed",
      scriptVersionId: versionId,
      failure: ENQUEUE_FAILURE,
      onlyFor: versionId,
    });
  }
}

/** pending → failed with a user-readable reason. Returns whether this call changed it. */
export async function markFailed(
  versionId: string,
  failure: string,
  damiRunId?: string | null,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(scriptVersion)
      .where(and(eq(scriptVersion.id, versionId), eq(scriptVersion.status, "pending")))
      .for("update");
    if (!row) return false;
    const notes: ScriptDamiNotes = { ...readNotes(row.damiNotes), failure };
    await tx
      .update(scriptVersion)
      .set({
        status: "failed",
        damiNotes: notes,
        ...(damiRunId ? { damiRunId } : {}),
      })
      .where(eq(scriptVersion.id, versionId));
    await logEvent(tx, row.projectId, null, "script.failed", { versionId, failure });
    return true;
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Starting a script                                                                           */
/* ------------------------------------------------------------------------------------------ */

/** New generated version (pending) from the user's brief; enqueues `script.write`. */
export async function startFromBrief(input: {
  projectId: string;
  userId: string;
  brief: string;
}): Promise<ScriptVersionView | null> {
  const { projectId, userId, brief } = parseInput(startFromBriefSchema, input);
  if (!uuidSchema.safeParse(projectId).success) return null;
  const created = await getDb().transaction(async (tx) => {
    const owned = await lockOwnedProject(tx, projectId, userId);
    if (!owned) return null;
    assertScriptStageOpen(owned);
    const latest = await latestVersion(tx, projectId);
    if (latest?.status === "pending") throw new ScriptInputError(BUSY_MESSAGE);
    const row = await insertVersion(
      tx,
      { projectId, source: "generated", status: "pending", brief, createdBy: userId },
      latest,
    );
    await logEvent(tx, projectId, userId, "script.started", {
      versionId: row.id,
      source: "generated",
    });
    return row;
  });
  if (!created) return null;
  await enqueueForVersion(created);
  return loadView(created.id);
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
  const created = await getDb().transaction(async (tx) => {
    const owned = await lockOwnedProject(tx, projectId, userId);
    if (!owned) return null;
    assertScriptStageOpen(owned);
    const latest = await latestVersion(tx, projectId);
    if (latest?.status === "pending") throw new ScriptInputError(BUSY_MESSAGE);
    const row = await insertVersion(
      tx,
      { projectId, source: "uploaded", status: "pending", fileId, createdBy: userId },
      latest,
    );
    await logEvent(tx, projectId, userId, "script.started", {
      versionId: row.id,
      source: "uploaded",
      fileId,
    });
    return row;
  });
  if (!created) return null;
  await enqueueForVersion(created);
  return loadView(created.id);
}

/* ------------------------------------------------------------------------------------------ */
/* Reading                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export async function getScriptState(
  projectId: string,
  userId: string,
): Promise<ScriptState | null> {
  if (!(await ownedProject(projectId, userId))) return null;
  const db = getDb();
  const versions = await db
    .select({
      id: scriptVersion.id,
      versionNumber: scriptVersion.versionNumber,
      status: scriptVersion.status,
      source: scriptVersion.source,
      createdAt: scriptVersion.createdAt,
    })
    .from(scriptVersion)
    .where(projectScope(projectId))
    .orderBy(desc(scriptVersion.versionNumber))
    .limit(MAX_LISTED_VERSIONS);
  const latest = versions[0];
  const current = latest ? await loadView(latest.id) : null;
  const [acceptedRow] = await db
    .select({ id: scriptVersion.id })
    .from(scriptVersion)
    .where(and(projectScope(projectId), eq(scriptVersion.status, "accepted")))
    .orderBy(desc(scriptVersion.versionNumber))
    .limit(1);
  const accepted = acceptedRow
    ? acceptedRow.id === current?.id
      ? current
      : await loadView(acceptedRow.id)
    : null;
  return { current, accepted, versions, busy: current?.status === "pending" };
}

/** One version of one of the user's projects. */
export async function getScriptVersion(
  versionId: string,
  userId: string,
): Promise<ScriptVersionView | null> {
  if (!uuidSchema.safeParse(versionId).success) return null;
  const [row] = await getDb()
    .select({ version: scriptVersion, model: damiRun.model })
    .from(scriptVersion)
    .innerJoin(project, eq(project.id, scriptVersion.projectId))
    .leftJoin(damiRun, eq(damiRun.id, scriptVersion.damiRunId))
    .where(
      and(eq(scriptVersion.id, versionId), eq(project.ownerId, userId), isNull(project.archivedAt)),
    )
    .limit(1);
  return row ? toView(row.version, row.model) : null;
}

/* ------------------------------------------------------------------------------------------ */
/* Review                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/**
 * Accepts or rejects the latest version while it is in review, and records the review (with the
 * producing dami run). Rejecting creates the next version (revised, pending) and enqueues
 * `script.revise`; the result is that new version. Accepting supersedes the previous accepted
 * version, advances `script → pre_production` and enqueues `script.detect-assets`; the result is
 * the accepted version.
 */
export async function submitScriptReview(input: {
  projectId: string;
  userId: string;
  versionId: string;
  decision: "accepted" | "rejected";
  issueCodes?: string[];
  note?: string;
  comments?: ReviewComment[];
}): Promise<ScriptVersionView | null> {
  const parsed = parseInput(submitReviewSchema, input);
  const { projectId, userId, versionId, decision } = parsed;
  const issueCodes = [...new Set(parsed.issueCodes ?? [])];
  const note = parsed.note ? parsed.note : null;
  const comments = parsed.comments ?? [];
  if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(versionId).success) {
    return null;
  }
  if (decision === "rejected" && issueCodes.length === 0 && !note && comments.length === 0) {
    throw new ScriptInputError(
      "Say what to change: pick an issue, write a note or comment on the text.",
    );
  }

  const outcome = await getDb().transaction(async (tx) => {
    const owned = await lockOwnedProject(tx, projectId, userId);
    if (!owned) return null;
    const latest = await latestVersion(tx, projectId);
    const [version] = await tx
      .select()
      .from(scriptVersion)
      .where(and(eq(scriptVersion.id, versionId), projectScope(projectId)))
      .limit(1);
    if (!version) return null;
    if (version.status !== "in_review" || latest?.id !== version.id) {
      throw new ScriptInputError("This version is no longer waiting for review. Reload the page.");
    }
    const content = version.content ?? "";
    for (const comment of comments) {
      if (comment.end < comment.start || comment.end > content.length) {
        throw new ScriptInputError("A comment points outside the script. Reload and try again.");
      }
      if (!containsQuoteInScript(content, comment.quote)) {
        throw new ScriptInputError(
          "A comment points at text that is not in this version. Reload and try again.",
        );
      }
    }

    const now = new Date();
    await tx.insert(review).values({
      projectId,
      userId,
      subjectType: "script_version",
      subjectId: version.id,
      decision,
      issueCodes: decision === "rejected" ? issueCodes : [],
      note,
      comments,
      damiRunId: version.damiRunId,
    });

    if (decision === "rejected") {
      await tx
        .update(scriptVersion)
        .set({ status: "rejected", decidedAt: now })
        .where(eq(scriptVersion.id, version.id));
      const next = await insertVersion(
        tx,
        {
          projectId,
          parentId: version.id,
          source: "revised",
          status: "pending",
          brief: version.brief,
          createdBy: userId,
        },
        latest,
      );
      await logEvent(tx, projectId, userId, "script.rejected", {
        versionId: version.id,
        nextVersionId: next.id,
        issueCodes,
        comments: comments.length,
      });
      return { kind: "rejected" as const, row: next };
    }

    await tx
      .update(scriptVersion)
      .set({ status: "superseded" })
      .where(
        and(
          projectScope(projectId),
          eq(scriptVersion.status, "accepted"),
          ne(scriptVersion.id, version.id),
        ),
      );
    await tx
      .update(scriptVersion)
      .set({ status: "accepted", decidedAt: now })
      .where(eq(scriptVersion.id, version.id));
    await logEvent(tx, projectId, userId, "script.accepted", { versionId: version.id });
    await advanceStage({ projectId, from: "script", to: "pre_production" }, tx);
    await setSectioningState(
      { projectId, state: "running", scriptVersionId: version.id, failure: null },
      tx,
    );
    return { kind: "accepted" as const, row: version };
  });
  if (!outcome) return null;
  if (outcome.kind === "rejected") await enqueueForVersion(outcome.row);
  else await enqueueDetection(projectId, outcome.row.id);
  return loadView(outcome.row.id);
}

/**
 * Saves the user's own edit of the accepted script as a new version (source edited, parent the
 * accepted one), accepted at once; the previous one is superseded and `script.detect-assets` is
 * enqueued. Returns the accepted version unchanged when the content is the same.
 */
export async function editAcceptedScript(input: {
  projectId: string;
  userId: string;
  content: string;
}): Promise<ScriptVersionView | null> {
  const { projectId, userId, content } = parseInput(editAcceptedSchema, input);
  if (!uuidSchema.safeParse(projectId).success) return null;
  const outcome = await getDb().transaction(async (tx) => {
    const owned = await lockOwnedProject(tx, projectId, userId);
    if (!owned) return null;
    const [accepted] = await tx
      .select()
      .from(scriptVersion)
      .where(and(projectScope(projectId), eq(scriptVersion.status, "accepted")))
      .orderBy(desc(scriptVersion.versionNumber))
      .limit(1);
    if (!accepted) throw new ScriptInputError("There is no accepted script to edit yet.");
    if ((accepted.content ?? "").replace(/\r\n?/g, "\n").trim() === content) {
      return { changed: false as const, row: accepted };
    }
    const latest = await latestVersion(tx, projectId);
    if (latest?.status === "pending") throw new ScriptInputError(BUSY_MESSAGE);
    const notes = readNotes(accepted.damiNotes);
    const now = new Date();
    await tx
      .update(scriptVersion)
      .set({ status: "superseded" })
      .where(and(projectScope(projectId), eq(scriptVersion.status, "accepted")));
    const row = await insertVersion(
      tx,
      {
        projectId,
        parentId: accepted.id,
        source: "edited",
        status: "accepted",
        content,
        brief: accepted.brief,
        damiNotes: { title: notes.title ?? null, logline: notes.logline ?? null },
        createdBy: userId,
        decidedAt: now,
      },
      latest,
    );
    await logEvent(tx, projectId, userId, "script.edited", {
      versionId: row.id,
      parentId: accepted.id,
    });
    await advanceStage({ projectId, from: "script", to: "pre_production" }, tx);
    await setSectioningState(
      { projectId, state: "running", scriptVersionId: row.id, failure: null },
      tx,
    );
    return { changed: true as const, row };
  });
  if (!outcome) return null;
  if (outcome.changed) await enqueueDetection(projectId, outcome.row.id);
  return loadView(outcome.row.id);
}

/** Puts a failed version back to pending and re-enqueues its job. */
export async function retryScriptVersion(input: {
  projectId: string;
  userId: string;
  versionId: string;
}): Promise<ScriptVersionView | null> {
  const { projectId, userId, versionId } = parseInput(retrySchema, input);
  if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(versionId).success) {
    return null;
  }
  const row = await getDb().transaction(async (tx) => {
    const owned = await lockOwnedProject(tx, projectId, userId);
    if (!owned) return null;
    const [version] = await tx
      .select()
      .from(scriptVersion)
      .where(and(eq(scriptVersion.id, versionId), projectScope(projectId)))
      .limit(1);
    if (!version) return null;
    const latest = await latestVersion(tx, projectId);
    if (version.status !== "failed" || latest?.id !== version.id) {
      throw new ScriptInputError("Only the latest failed version can be retried.");
    }
    const [updated] = await tx
      .update(scriptVersion)
      .set({ status: "pending", damiNotes: { ...readNotes(version.damiNotes), failure: null } })
      .where(eq(scriptVersion.id, version.id))
      .returning();
    await logEvent(tx, projectId, userId, "script.retried", { versionId });
    return updated ?? null;
  });
  if (!row) return null;
  await enqueueForVersion(row);
  return loadView(row.id);
}
