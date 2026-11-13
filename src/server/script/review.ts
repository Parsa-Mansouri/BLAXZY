/** Reviewing a version, editing the accepted script, and retrying a failed version. */
import { and, desc, eq, ne } from "drizzle-orm";
import { setSectioningState } from "@/server/blocks";
import { isWriterReasonCode, writerReason } from "@/server/damis";
import { getDb, type DbTx } from "@/server/db/client";
import { review, scriptVersion, type ReviewComment } from "@/server/db/schema";
import { advanceStage, logProjectEvent } from "@/server/projects";
import { ScriptInputError } from "./errors";
import {
  BUSY_MESSAGE,
  enqueueDetection,
  enqueueForVersion,
  fixRequestsFor,
  insertVersion,
  latestVersion,
  loadView,
  lockOwnedProject,
  projectScope,
} from "./internal";
import { containsQuoteInScript } from "./quotes";
import {
  editAcceptedSchema,
  parseInput,
  retrySchema,
  submitReviewSchema,
  uuidSchema,
} from "./schemas";
import {
  readNotes,
  type ScriptDamiNotes,
  type ScriptVersionRow,
  type ScriptVersionView,
} from "./views";

/** A decision on the latest version in review, inside the reviewing transaction. */
type Decided = {
  tx: DbTx;
  projectId: string;
  userId: string;
  version: ScriptVersionRow;
  latest: ScriptVersionRow | null;
  now: Date;
};

/**
 * Rejects the version and starts its next one (pending, with its job): a script is revised
 * (`script.revise`), an outline is planned again from the feedback (generated). Returns the new
 * version.
 */
async function rejectVersion(
  decided: Decided,
  feedback: { issueCodes: string[]; note: string | null; comments: number; isOutline: boolean },
): Promise<ScriptVersionRow> {
  const { tx, projectId, userId, version, latest, now } = decided;
  const { issueCodes, note, isOutline } = feedback;
  await tx
    .update(scriptVersion)
    .set({ status: "rejected", decidedAt: now })
    .where(eq(scriptVersion.id, version.id));
  // An outline is re-planned from the note (generated again); a script is revised.
  const outlineFeedback = isOutline
    ? [
        ...issueCodes.map((c) => (isWriterReasonCode(c) ? writerReason(c).instruction : c)),
        note ?? "",
      ]
        .filter(Boolean)
        .join("\n")
    : null;
  const next = await insertVersion(
    tx,
    {
      projectId,
      parentId: version.id,
      source: isOutline ? "generated" : "revised",
      status: "pending",
      brief: version.brief,
      ...(outlineFeedback ? { damiNotes: { outlineFeedback } satisfies ScriptDamiNotes } : {}),
      createdBy: userId,
    },
    latest,
  );
  await logProjectEvent(tx, {
    projectId,
    userId,
    type: "script.rejected",
    payload: {
      versionId: version.id,
      nextVersionId: next.id,
      issueCodes,
      comments: feedback.comments,
    },
  });
  await enqueueForVersion(tx, next);
  return next;
}

/**
 * Accepts the version: the previous accepted one is superseded, the project moves
 * `script → pre_production`, sectioning is marked running and `script.detect-assets` is sent.
 */
async function acceptVersion(decided: Decided): Promise<ScriptVersionRow> {
  const { tx, projectId, userId, version, now } = decided;
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
  await logProjectEvent(tx, {
    projectId,
    userId,
    type: "script.accepted",
    payload: { versionId: version.id },
  });
  await advanceStage({ projectId, from: "script", to: "pre_production" }, tx);
  await setSectioningState(
    { projectId, state: "running", scriptVersionId: version.id, failure: null },
    tx,
  );
  await enqueueDetection(tx, version.id);
  return version;
}

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

  const decided = await getDb().transaction(async (tx) => {
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
    const versionNotes = readNotes(version.damiNotes);
    const isOutline = versionNotes.outline !== undefined && version.content === null;
    if (isOutline && decision === "accepted") {
      throw new ScriptInputError("Approve the outline first; the script is written from it.");
    }
    if (isOutline && comments.length > 0) {
      throw new ScriptInputError("Comments work on script text. Write a note for the outline.");
    }
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
      fixRequests: decision === "rejected" ? fixRequestsFor(issueCodes) : [],
      note,
      comments,
      damiRunId: version.damiRunId,
    });
    const context: Decided = { tx, projectId, userId, version, latest, now };
    return decision === "rejected"
      ? rejectVersion(context, { issueCodes, note, comments: comments.length, isOutline })
      : acceptVersion(context);
  });
  if (!decided) return null;
  return loadView(decided.id);
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
    // A revision still waiting for review answers the script this edit replaces: it would stay in
    // review forever behind the new version, so it is superseded too.
    const dropped = await tx
      .update(scriptVersion)
      .set({ status: "superseded", decidedAt: now })
      .where(and(projectScope(projectId), eq(scriptVersion.status, "in_review")))
      .returning({ id: scriptVersion.id });
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
    await logProjectEvent(tx, {
      projectId,
      userId,
      type: "script.edited",
      payload: {
        versionId: row.id,
        parentId: accepted.id,
        ...(dropped.length > 0 ? { supersededInReview: dropped.map((d) => d.id) } : {}),
      },
    });
    await advanceStage({ projectId, from: "script", to: "pre_production" }, tx);
    await setSectioningState(
      { projectId, state: "running", scriptVersionId: row.id, failure: null },
      tx,
    );
    await enqueueDetection(tx, row.id);
    return { changed: true as const, row };
  });
  if (!outcome) return null;
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
    const failedNotes = readNotes(version.damiNotes);
    const [updated] = await tx
      .update(scriptVersion)
      .set({ status: "pending", damiNotes: { ...failedNotes, failure: null } })
      .where(eq(scriptVersion.id, version.id))
      .returning();
    // The row is reset for the new attempt; the event keeps what the failed attempt left.
    await logProjectEvent(tx, {
      projectId,
      userId,
      type: "script.retried",
      payload: {
        versionId,
        previousFailure: failedNotes.failure ?? null,
        previousDamiRunId: version.damiRunId,
      },
    });
    if (updated) await enqueueForVersion(tx, updated);
    return updated ?? null;
  });
  if (!row) return null;
  return loadView(row.id);
}
