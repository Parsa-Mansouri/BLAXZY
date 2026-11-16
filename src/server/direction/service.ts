/**
 * The Director's run set for a script version (`direction`, `direction_batch`): starting a run,
 * storing a plan and queueing its batches, storing a batch, and assembling the finished blocks.
 * Worker-side (handlers call it); every state change is conditional on the row's current status,
 * so a duplicate or stale job changes nothing.
 *
 * Idempotent completion: batches run in parallel on any worker and each writes only its own
 * `direction_batch` row. Storing a batch locks the direction row, so two batches finishing at
 * once are serialised; the one that finds no batch pending assembles the blocks in the same
 * transaction (`replaceBlocks`, the sectioning state, the direction `ready`). A repeated call finds
 * the batch already done, or the direction no longer open, and returns without effect.
 */
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { replaceBlocks, setSectioningState, type ReplaceBlocksResult } from "@/server/blocks";
import {
  blockSchema,
  type DirectorBlock,
  type DirectorOutput,
  type DirectorPlanOutput,
} from "@/server/damis";
import { getDb, type DbTx } from "@/server/db/client";
import { direction, directionBatch, project, scriptVersion } from "@/server/db/schema";
import { directionWrite, enqueue } from "@/server/jobs";
import { logProjectEvent } from "@/server/projects";
import { directedBlocks } from "./blocks";
import { batchRanges, directionContextSchema, type DirectionContext } from "./context";

export type DirectionRow = typeof direction.$inferSelect;

const ACTIVE = ["pending", "planned", "writing"] as const;

/**
 * Starts a run: supersedes the project's runs still in flight and adds a `pending` one. Locks the
 * project row, which serialises the runs of one project.
 */
export async function startDirection(input: {
  projectId: string;
  scriptVersionId: string;
  creativeBibleId: string | null;
  mode: "full" | "plan";
  context: DirectionContext;
}): Promise<string> {
  return getDb().transaction(async (tx) => {
    await tx
      .select({ id: project.id })
      .from(project)
      .where(eq(project.id, input.projectId))
      .for("update");
    await tx
      .update(direction)
      .set({ status: "superseded", finishedAt: new Date() })
      .where(and(eq(direction.projectId, input.projectId), inArray(direction.status, [...ACTIVE])));
    const [row] = await tx
      .insert(direction)
      .values({
        projectId: input.projectId,
        scriptVersionId: input.scriptVersionId,
        creativeBibleId: input.creativeBibleId,
        blockMode: input.context.block_mode,
        mode: input.mode,
        context: input.context,
      })
      .returning({ id: direction.id });
    if (!row) throw new Error("direction insert returned no row");
    return row.id;
  });
}

/** The newest direction of a script version, any status. */
export async function getLatestDirection(
  projectId: string,
  scriptVersionId: string,
): Promise<DirectionRow | null> {
  const [row] = await getDb()
    .select()
    .from(direction)
    .where(and(eq(direction.projectId, projectId), eq(direction.scriptVersionId, scriptVersionId)))
    .orderBy(desc(direction.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * The newest finished run (`ready`, or `superseded` by a later one) of a script version: the
 * Director's header (its continuity bible) and frozen context (platform numbers, Creative Bible
 * or the stub) that a block of that version was written under. Null when there is none.
 */
export async function getFinishedDirection(
  projectId: string,
  scriptVersionId: string,
): Promise<DirectionRow | null> {
  const [row] = await getDb()
    .select()
    .from(direction)
    .where(
      and(
        eq(direction.projectId, projectId),
        eq(direction.scriptVersionId, scriptVersionId),
        inArray(direction.status, ["ready", "superseded"]),
        sql`${direction.header} is not null`,
      ),
    )
    .orderBy(sql`(${direction.status} = 'ready') desc`, desc(direction.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listBatches(directionId: string) {
  return getDb()
    .select()
    .from(directionBatch)
    .where(eq(directionBatch.directionId, directionId))
    .orderBy(asc(directionBatch.batchIndex));
}

/** Fails a run (and its pending batches) with a user-readable reason; `failed` is false when it was not open. */
export async function failDirection(
  directionId: string,
  failure: string,
  damiRunId?: string | null,
): Promise<{ failed: boolean }> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(direction)
      .set({
        status: "failed",
        failure,
        finishedAt: new Date(),
        ...(damiRunId
          ? { damiRunIds: sql`${direction.damiRunIds} || ${JSON.stringify([damiRunId])}::jsonb` }
          : {}),
      })
      .where(and(eq(direction.id, directionId), inArray(direction.status, [...ACTIVE])))
      .returning({ projectId: direction.projectId });
    if (!row) return { failed: false };
    await tx
      .update(directionBatch)
      .set({ status: "failed", failure, finishedAt: new Date() })
      .where(
        and(eq(directionBatch.directionId, directionId), eq(directionBatch.status, "pending")),
      );
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "direction.failed",
      payload: { directionId, failure },
    });
    return { failed: true };
  });
}

/** The project-level part of an output (everything but the blocks). */
function headerOf(output: DirectorOutput | DirectorPlanOutput): Record<string, unknown> {
  const { blocks, ...header } = output;
  void blocks;
  return header;
}

/**
 * Plan stored: the direction becomes `planned`, one batch row and one `direction.write` job per
 * range are added, all in one transaction (no batch without its job). Returns the batch count, or
 * 0 when the run is no longer `pending`.
 */
export async function savePlan(input: {
  directionId: string;
  plan: DirectorPlanOutput;
  runId: string;
}): Promise<number> {
  const { plan } = input;
  const ranges = batchRanges(plan.blocks.length);
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(direction)
      .set({
        status: "planned",
        plan,
        header: headerOf(plan),
        warnings: plan.warnings,
        batchCount: ranges.length,
        damiRunIds: [input.runId],
      })
      .where(and(eq(direction.id, input.directionId), eq(direction.status, "pending")))
      .returning({ projectId: direction.projectId });
    if (!row) return 0;
    await tx.insert(directionBatch).values(
      ranges.map((r, i) => ({
        directionId: input.directionId,
        batchIndex: i,
        blockFrom: r.from,
        blockTo: r.to,
      })),
    );
    for (let i = 0; i < ranges.length; i++) {
      await enqueue(directionWrite, { directionId: input.directionId, batchIndex: i }, { tx });
    }
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "direction.planned",
      payload: {
        directionId: input.directionId,
        blocks: plan.blocks.length,
        batches: ranges.length,
      },
    });
    return ranges.length;
  });
}

export type StoredOutcome =
  | { stored: false }
  | { stored: true; assembled: false }
  | {
      stored: true;
      assembled: true;
      projectId: string;
      scriptVersionId: string;
      /** `skipped` is set when a newer script version was accepted meanwhile (nothing replaced). */
      replaced: ReplaceBlocksResult;
    };

/** Stores the finished blocks of a locked direction row and marks it ready (in the caller's transaction). */
async function assemble(
  tx: DbTx,
  row: DirectionRow,
  parts: {
    blocks: DirectorBlock[];
    header: Record<string, unknown>;
    warnings: DirectionRow["warnings"];
    runIds: (string | undefined)[];
    damiRunIds: string[];
  },
): Promise<Extract<StoredOutcome, { assembled: true }>> {
  const context = directionContextSchema.parse(row.context);
  const [version] = await tx
    .select({ content: scriptVersion.content })
    .from(scriptVersion)
    .where(eq(scriptVersion.id, row.scriptVersionId))
    .limit(1);
  const blocks = directedBlocks({
    blocks: parts.blocks,
    script: version?.content ?? "",
    bindings: context.bindings,
    runIds: parts.runIds,
  });
  const replaced = await replaceBlocks(
    {
      projectId: row.projectId,
      scriptVersionId: row.scriptVersionId,
      blocks,
      damiRunIds: parts.damiRunIds,
    },
    tx,
  );
  const now = new Date();
  if (replaced.skipped) {
    await tx
      .update(direction)
      .set({ status: "superseded", finishedAt: now })
      .where(eq(direction.id, row.id));
  } else {
    await tx
      .update(direction)
      .set({
        status: "ready",
        header: parts.header,
        warnings: parts.warnings,
        damiRunIds: parts.damiRunIds,
        finishedAt: now,
        failure: null,
      })
      .where(eq(direction.id, row.id));
    await tx
      .update(direction)
      .set({ status: "superseded" })
      .where(
        and(
          eq(direction.projectId, row.projectId),
          eq(direction.status, "ready"),
          ne(direction.id, row.id),
        ),
      );
    await setSectioningState(
      {
        projectId: row.projectId,
        state: "done",
        scriptVersionId: row.scriptVersionId,
        failure: null,
        onlyFor: row.scriptVersionId,
        resetBlocks: replaced.reset,
      },
      tx,
    );
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "direction.ready",
      payload: { directionId: row.id, blocks: blocks.length, ...replaced },
    });
  }
  return {
    stored: true,
    assembled: true,
    projectId: row.projectId,
    scriptVersionId: row.scriptVersionId,
    replaced,
  };
}

async function lockOpen(tx: DbTx, directionId: string, statuses: readonly string[]) {
  const [row] = await tx
    .select()
    .from(direction)
    .where(eq(direction.id, directionId))
    .for("update");
  return row && statuses.includes(row.status) ? row : null;
}

/** A `full` run's answer: the blocks are stored and the direction is ready, in one transaction. */
export async function saveFull(input: {
  directionId: string;
  output: DirectorOutput;
  runId: string;
}): Promise<StoredOutcome> {
  return getDb().transaction(async (tx) => {
    const row = await lockOpen(tx, input.directionId, ["pending"]);
    if (!row) return { stored: false };
    return assemble(tx, row, {
      blocks: input.output.blocks,
      header: headerOf(input.output),
      warnings: input.output.warnings,
      runIds: input.output.blocks.map(() => input.runId),
      damiRunIds: [input.runId],
    });
  });
}

const writtenBlocks = z.array(blockSchema);

/**
 * A batch's answer. Idempotent: a batch already done, or a direction no longer open, changes
 * nothing. The last batch to finish assembles every batch's blocks in order.
 */
export async function saveBatch(input: {
  directionId: string;
  batchIndex: number;
  output: DirectorOutput;
  runId: string;
}): Promise<StoredOutcome> {
  return getDb().transaction(async (tx) => {
    const row = await lockOpen(tx, input.directionId, ["planned", "writing"]);
    if (!row) return { stored: false };
    const done = await tx
      .update(directionBatch)
      .set({
        status: "done",
        blocks: input.output.blocks,
        damiRunId: input.runId,
        failure: null,
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(directionBatch.directionId, input.directionId),
          eq(directionBatch.batchIndex, input.batchIndex),
          eq(directionBatch.status, "pending"),
        ),
      )
      .returning({ id: directionBatch.id });
    if (done.length === 0) return { stored: false };
    const batches = await tx
      .select()
      .from(directionBatch)
      .where(eq(directionBatch.directionId, input.directionId))
      .orderBy(asc(directionBatch.batchIndex));
    if (batches.some((b) => b.status !== "done")) {
      if (row.status === "planned") {
        await tx.update(direction).set({ status: "writing" }).where(eq(direction.id, row.id));
      }
      return { stored: true, assembled: false };
    }
    const perBatch = batches.map((b) => ({
      blocks: writtenBlocks.parse(b.blocks),
      run: b.damiRunId,
    }));
    const runIds = new Set([
      ...row.damiRunIds,
      ...batches.flatMap((b) => (b.damiRunId ? [b.damiRunId] : [])),
    ]);
    return assemble(tx, row, {
      blocks: perBatch.flatMap((b) => b.blocks),
      header: (row.header ?? {}) as Record<string, unknown>,
      warnings: row.warnings,
      runIds: perBatch.flatMap((b) => b.blocks.map(() => b.run ?? undefined)),
      damiRunIds: [...runIds],
    });
  });
}

/** What a batch handler needs: the run, its frozen context, the saved plan and the batch. */
export async function loadBatchJob(directionId: string, batchIndex: number) {
  const db = getDb();
  const [row] = await db.select().from(direction).where(eq(direction.id, directionId)).limit(1);
  if (!row) return null;
  const [batch] = await db
    .select()
    .from(directionBatch)
    .where(
      and(eq(directionBatch.directionId, directionId), eq(directionBatch.batchIndex, batchIndex)),
    )
    .limit(1);
  if (!batch) return null;
  const [owner] = await db
    .select({ ownerId: project.ownerId, archivedAt: project.archivedAt })
    .from(project)
    .where(eq(project.id, row.projectId))
    .limit(1);
  const [version] = await db
    .select({ content: scriptVersion.content })
    .from(scriptVersion)
    .where(eq(scriptVersion.id, row.scriptVersionId))
    .limit(1);
  if (!owner || owner.archivedAt || !version?.content) return null;
  return {
    direction: row,
    batch,
    ownerId: owner.ownerId,
    script: version.content,
    context: directionContextSchema.parse(row.context),
  };
}

/** Marks a run still in flight as superseded (its result is not wanted any more). */
export async function supersedeDirection(directionId: string): Promise<void> {
  await getDb()
    .update(direction)
    .set({ status: "superseded", finishedAt: new Date() })
    .where(and(eq(direction.id, directionId), inArray(direction.status, [...ACTIVE])));
}

/** True while the run may still be stored (not superseded or failed meanwhile). */
export async function isDirectionOpen(directionId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ status: direction.status })
    .from(direction)
    .where(eq(direction.id, directionId))
    .limit(1);
  return row !== undefined && (ACTIVE as readonly string[]).includes(row.status);
}
