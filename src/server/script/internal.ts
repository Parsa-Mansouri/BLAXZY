/**
 * Shared steps of the Script services (not exported from the module index): ownership and the
 * project lock, the stage check, version numbering, the job of each version, and `markFailed`
 * for the job handlers.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { type DbTx, getDb } from "@/server/db/client";
import { damiRun, type ScriptSource, scriptVersion } from "@/server/db/schema";
import {
  enqueue,
  type JobDefinition,
  scriptCheck,
  scriptDetectAssets,
  scriptEnhance,
  scriptRevise,
  scriptWrite,
} from "@/server/jobs";
import { assertStageOpen, findOwnedProject, logProjectEvent } from "@/server/projects";
import { ScriptInputError } from "./errors";
import {
  readNotes,
  type ScriptDamiNotes,
  type ScriptVersionRow,
  type ScriptVersionView,
  toView,
} from "./views";

export const BUSY_MESSAGE =
  "A script is still being prepared. Wait for it to finish, then try again.";

/** The job that produces a version of each source. */
const JOB_FOR_SOURCE: Record<
  ScriptSource,
  JobDefinition<typeof scriptWrite.payload> | JobDefinition<typeof scriptEnhance.payload> | null
> = {
  generated: scriptWrite,
  uploaded: scriptCheck,
  revised: scriptRevise,
  edited: null,
  enhanced: scriptEnhance,
};

export const projectScope = (projectId: string) =>
  and(eq(scriptVersion.projectId, projectId), isNull(scriptVersion.episodeId));

/** The user's project, row-locked (`FOR UPDATE`), or null when not theirs. */
export async function lockOwnedProject(tx: DbTx, projectId: string, userId: string) {
  return findOwnedProject(tx, projectId, userId, { lock: "update" });
}

export async function ownedProject(projectId: string, userId: string) {
  return findOwnedProject(getDb(), projectId, userId);
}

const STYLE_FIRST = "Choose the project's style before working on the script.";

export function assertScriptStageOpen(row: { stage: string; style: unknown }): void {
  if (row.style === null) throw new ScriptInputError(STYLE_FIRST);
  assertStageOpen(row, "script", ScriptInputError, STYLE_FIRST);
}

export async function latestVersion(tx: DbTx, projectId: string): Promise<ScriptVersionRow | null> {
  const [row] = await tx
    .select()
    .from(scriptVersion)
    .where(projectScope(projectId))
    .orderBy(desc(scriptVersion.versionNumber))
    .limit(1);
  return row ?? null;
}

export async function insertVersion(
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

/** The version with its producing run's model, or null. */
export async function loadView(versionId: string): Promise<ScriptVersionView | null> {
  const [row] = await getDb()
    .select({ version: scriptVersion, model: damiRun.model })
    .from(scriptVersion)
    .leftJoin(damiRun, eq(damiRun.id, scriptVersion.damiRunId))
    .where(eq(scriptVersion.id, versionId))
    .limit(1);
  return row ? toView(row.version, row.model) : null;
}

/**
 * Sends the job that produces the version on the transaction that wrote it: the pending version
 * and its job are committed together or not at all (if the queue is unreachable the transaction
 * fails and the user sees an error instead of a version waiting forever).
 */
export async function enqueueForVersion(tx: DbTx, row: ScriptVersionRow): Promise<void> {
  const job = JOB_FOR_SOURCE[row.source];
  if (!job) return;
  await enqueue(job, { scriptVersionId: row.id }, { tx });
}

/** Asset detection (then sectioning) of a newly accepted version, on the accepting transaction. */
export async function enqueueDetection(tx: DbTx, versionId: string): Promise<void> {
  await enqueue(scriptDetectAssets, { scriptVersionId: versionId }, { tx });
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
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "script.failed",
      payload: { versionId, failure },
    });
    return true;
  });
}
