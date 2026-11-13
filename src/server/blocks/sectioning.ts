/** Where sectioning stands (`project.stageState.sectioning`), and retrying a failed run. */
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type DbExecutor, getDb } from "@/server/db/client";
import { project, promptBlock, scriptVersion } from "@/server/db/schema";
import { enqueue, scriptDetectAssets } from "@/server/jobs";
import { findOwnedProject, logProjectEvent } from "@/server/projects";
import { BlocksInputError, current, ownedProject, parse, uuid } from "./common";

export const SECTIONING_STATES = ["idle", "running", "done", "failed", "stale"] as const;

export type SectioningState = (typeof SECTIONING_STATES)[number];

/** What `project.stageState.sectioning` holds (written by the script services and handlers). */
export type SectioningRecord = {
  state: "running" | "done" | "failed";
  scriptVersionId: string;
  failure: string | null;
  /** Done: how many shots this version sent back through Production's preparation. */
  resetBlocks?: number;
};

export type SectioningStatus = {
  state: SectioningState;
  blockCount: number;
  failure: string | null;
  /** Shots the last script edit sent back through Production's preparation (0 when none). */
  resetBlocks: number;
};

const sectioningRecordSchema = z.object({
  state: z.enum(["running", "done", "failed"]),
  scriptVersionId: z.string(),
  failure: z.string().nullable(),
  resetBlocks: z.number().int().min(0).optional(),
});

export function readSectioningRecord(stageState: Record<string, unknown>): SectioningRecord | null {
  const parsed = sectioningRecordSchema.safeParse(stageState.sectioning);
  return parsed.success ? parsed.data : null;
}

/** Where sectioning stands for the project (idle before the first accepted script). */
export async function getSectioningStatus(
  projectId: string,
  userId: string,
): Promise<SectioningStatus | null> {
  const owned = await ownedProject(projectId, userId);
  if (!owned) return null;
  const record = readSectioningRecord(owned.stageState);
  const [counts] = await getDb()
    .select({
      total: count(),
      stale: sql<number>`count(*) filter (where ${promptBlock.stale})`.mapWith(Number),
    })
    .from(promptBlock)
    .where(and(eq(promptBlock.projectId, projectId), current));
  const blockCount = counts?.total ?? 0;
  const anyStale = (counts?.stale ?? 0) > 0;
  const resetBlocks = record?.state === "done" ? (record.resetBlocks ?? 0) : 0;
  if (record?.state === "running")
    return { state: "running", blockCount, failure: null, resetBlocks };
  if (record?.state === "failed")
    return { state: "failed", blockCount, failure: record.failure, resetBlocks };
  if (anyStale) return { state: "stale", blockCount, failure: null, resetBlocks };
  if (record?.state === "done" || blockCount > 0)
    return { state: "done", blockCount, failure: null, resetBlocks };
  return { state: "idle", blockCount, failure: null, resetBlocks };
}

/**
 * Writes `project.stageState.sectioning`. With `onlyFor`, writes only while the record still
 * belongs to that script version (a handler for an older version never overwrites a newer state).
 * Returns whether it was written.
 */
export async function setSectioningState(
  input: SectioningRecord & { projectId: string; onlyFor?: string },
  executor: DbExecutor = getDb(),
): Promise<boolean> {
  const record: SectioningRecord = {
    state: input.state,
    scriptVersionId: input.scriptVersionId,
    failure: input.failure,
    ...(input.resetBlocks !== undefined ? { resetBlocks: input.resetBlocks } : {}),
  };
  const updated = await executor
    .update(project)
    .set({
      stageState: sql`jsonb_set(${project.stageState}, '{sectioning}', ${JSON.stringify(record)}::jsonb, true)`,
    })
    .where(
      and(
        eq(project.id, input.projectId),
        input.onlyFor
          ? sql`${project.stageState}->'sectioning'->>'scriptVersionId' = ${input.onlyFor}`
          : undefined,
      ),
    )
    .returning({ id: project.id });
  return updated.length > 0;
}

/**
 * Runs asset detection and sectioning again after a failed run: only while the project's
 * sectioning state is `failed`. Sets it to `running` for the accepted script version and enqueues
 * `script.detect-assets` (which queues sectioning in turn) in the same transaction. Returns the
 * new status, or null when the project is missing, archived or not the user's.
 */
export async function retrySectioning(input: {
  projectId: string;
  userId: string;
}): Promise<SectioningStatus | null> {
  const { projectId, userId } = parse(
    z.object({ projectId: z.string(), userId: z.string().min(1) }),
    input,
  );
  if (!uuid.safeParse(projectId).success) return null;
  const versionId = await getDb().transaction(async (tx) => {
    const owned = await findOwnedProject(tx, projectId, userId, { lock: "update" });
    if (!owned) return null;
    if (readSectioningRecord(owned.stageState)?.state !== "failed") {
      throw new BlocksInputError("Only a run that failed can be tried again.");
    }
    const [accepted] = await tx
      .select({ id: scriptVersion.id })
      .from(scriptVersion)
      .where(
        and(
          eq(scriptVersion.projectId, projectId),
          isNull(scriptVersion.episodeId),
          eq(scriptVersion.status, "accepted"),
        ),
      )
      .orderBy(desc(scriptVersion.versionNumber))
      .limit(1);
    if (!accepted) throw new BlocksInputError("There is no accepted script to prepare.");
    await setSectioningState(
      { projectId, state: "running", scriptVersionId: accepted.id, failure: null },
      tx,
    );
    await logProjectEvent(tx, {
      projectId,
      userId,
      type: "sectioning.retried",
      payload: { versionId: accepted.id },
    });
    await enqueue(scriptDetectAssets, { scriptVersionId: accepted.id }, { tx });
    return accepted.id;
  });
  if (!versionId) return null;
  return getSectioningStatus(projectId, userId);
}
