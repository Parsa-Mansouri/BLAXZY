/**
 * The Director's run set for a script version (`direction`, `direction_batch`): starting a run,
 * storing the craft pipeline's shot plan and look, its scene batches, the Breakdown's plan and its
 * write batches, storing a batch, and assembling the finished blocks.
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
  lookSchema,
  sceneVisualSchema,
  shotPlanSchema,
  storedBlockSchema,
  type DirectorBlock,
  type DirectorOutput,
  type DirectorPlanOutput,
  type Look,
  type SceneVisual,
  type ShotPlan,
} from "@/server/damis";
import { getDb, type DbTx } from "@/server/db/client";
import {
  direction,
  directionBatch,
  DIRECTION_ACTIVE_STATUSES,
  project,
  scriptVersion,
  type DirectionMode,
} from "@/server/db/schema";
import { directionScene, directionWrite, enqueue } from "@/server/jobs";
import { logProjectEvent } from "@/server/projects";
import { directedBlocks } from "./blocks";
import { storedBreakdownSchema } from "./breakdown";
import { batchRanges, directionContextSchema, type DirectionContext } from "./context";
import { buildCraftPlan, sceneIdsOf, SCENE_BATCH_SCENES } from "./craft-plan";
import type { CraftSelection } from "./craft";

export type DirectionRow = typeof direction.$inferSelect;

const ACTIVE = DIRECTION_ACTIVE_STATUSES;

/** `direction.visual`: the look, and the lit scenes once every scene batch is done. */
export const directionVisualSchema = z.object({
  look: lookSchema,
  scenes: z.array(sceneVisualSchema),
});
export type DirectionVisual = z.output<typeof directionVisualSchema>;

/**
 * Starts a run: supersedes the project's runs still in flight and adds a new one (`directing` for
 * a craft run, `pending` for an older mode). Locks the project row, which serialises the runs of
 * one project.
 */
export async function startDirection(input: {
  projectId: string;
  scriptVersionId: string;
  creativeBibleId: string | null;
  mode: DirectionMode;
  context: DirectionContext;
  craft?: CraftSelection;
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
        status: input.mode === "craft" ? "directing" : "pending",
        context: input.context,
        ...(input.craft ? { craft: input.craft } : {}),
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

/** A run's batches of one kind (`write` by default), in order. */
export async function listBatches(directionId: string, kind: "scene" | "write" = "write") {
  return getDb()
    .select()
    .from(directionBatch)
    .where(and(eq(directionBatch.directionId, directionId), eq(directionBatch.kind, kind)))
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
function headerOf(output: DirectorPlanOutput): Record<string, unknown> {
  const { blocks, ...header } = output;
  void blocks;
  return header;
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

/** Batch blocks read back from their rows; a batch written by Director v1.3 is upgraded. */
const writtenBlocks = z.array(storedBlockSchema);

const isWrite = (directionId: string) =>
  and(eq(directionBatch.directionId, directionId), eq(directionBatch.kind, "write"));
const isScene = (directionId: string) =>
  and(eq(directionBatch.directionId, directionId), eq(directionBatch.kind, "scene"));

/* -------------------------------------------------------------------------- */
/* Craft runs: shot plan, look and scene batches                               */
/* -------------------------------------------------------------------------- */

const appendRunId = (runId: string) =>
  sql`${direction.damiRunIds} || ${JSON.stringify([runId])}::jsonb`;

/** The film-director's shot plan, stored while the run is `directing`. False when it is not. */
export async function saveShotPlan(input: {
  directionId: string;
  shotPlan: ShotPlan;
  runId: string;
}): Promise<boolean> {
  const rows = await getDb()
    .update(direction)
    .set({
      shotPlan: input.shotPlan,
      damiRunIds: appendRunId(input.runId),
    })
    .where(and(eq(direction.id, input.directionId), eq(direction.status, "directing")))
    .returning({ id: direction.id });
  return rows.length > 0;
}

/** Inclusive 1-based ranges of `SCENE_BATCH_SCENES` scenes covering 1..total. */
export function sceneBatchRanges(total: number): { from: number; to: number }[] {
  return batchRanges(total, SCENE_BATCH_SCENES);
}

/**
 * The look stored: the direction becomes `lighting`, and one `scene` batch row and one
 * `direction.scene` job per range of the shot plan's scenes are added, in one transaction (no
 * batch without its job). Returns the batch count, or 0 when the run is no longer `directing`.
 */
export async function startLighting(input: {
  directionId: string;
  look: Look;
  runId: string;
}): Promise<number> {
  return getDb().transaction(async (tx) => {
    const row = await lockOpen(tx, input.directionId, ["directing"]);
    if (!row) return 0;
    const shotPlan = shotPlanSchema.parse(row.shotPlan);
    const ranges = sceneBatchRanges(sceneIdsOf(shotPlan).length);
    const visual: DirectionVisual = { look: input.look, scenes: [] };
    await tx
      .update(direction)
      .set({ status: "lighting", visual, damiRunIds: appendRunId(input.runId) })
      .where(eq(direction.id, row.id));
    await tx.insert(directionBatch).values(
      ranges.map((r, i) => ({
        directionId: input.directionId,
        kind: "scene" as const,
        batchIndex: i,
        blockFrom: r.from,
        blockTo: r.to,
      })),
    );
    for (let i = 0; i < ranges.length; i++) {
      await enqueue(directionScene, { directionId: input.directionId, batchIndex: i }, { tx });
    }
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "direction.lighting",
      payload: {
        directionId: input.directionId,
        shots: shotPlan.shots.length,
        batches: ranges.length,
      },
    });
    return ranges.length;
  });
}

const sceneVisuals = z.array(sceneVisualSchema);

/** What a scene batch handler needs: the run, its context, shot plan, look and the batch's scenes. */
export async function loadSceneBatchJob(directionId: string, batchIndex: number) {
  const db = getDb();
  const [row] = await db.select().from(direction).where(eq(direction.id, directionId)).limit(1);
  if (!row) return null;
  const [batch] = await db
    .select()
    .from(directionBatch)
    .where(and(isScene(directionId), eq(directionBatch.batchIndex, batchIndex)))
    .limit(1);
  if (!batch) return null;
  const [owner] = await db
    .select({ ownerId: project.ownerId, archivedAt: project.archivedAt })
    .from(project)
    .where(eq(project.id, row.projectId))
    .limit(1);
  if (!owner || owner.archivedAt) return null;
  const context = directionContextSchema.parse(row.context);
  const shotPlan = shotPlanSchema.parse(row.shotPlan);
  const visual = directionVisualSchema.parse(row.visual);
  const sceneIds = sceneIdsOf(shotPlan).slice(batch.blockFrom - 1, batch.blockTo);
  return {
    direction: row,
    batch,
    ownerId: owner.ownerId,
    context,
    shotPlan,
    look: visual.look,
    sceneIds,
    /** Scenes this batch already lit (an earlier attempt saved them). */
    done: batch.sceneVisuals ? sceneVisuals.parse(batch.sceneVisuals) : [],
  };
}

/** Saves a scene batch's progress (the scenes lit so far) while it is pending. */
export async function saveSceneProgress(input: {
  directionId: string;
  batchIndex: number;
  scenes: SceneVisual[];
  runId: string;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const updated = await tx
      .update(directionBatch)
      .set({ sceneVisuals: input.scenes })
      .where(
        and(
          isScene(input.directionId),
          eq(directionBatch.batchIndex, input.batchIndex),
          eq(directionBatch.status, "pending"),
        ),
      )
      .returning({ id: directionBatch.id });
    if (updated.length === 0) return;
    await tx
      .update(direction)
      .set({ damiRunIds: appendRunId(input.runId) })
      .where(and(eq(direction.id, input.directionId), eq(direction.status, "lighting")));
  });
}

export type SceneBatchOutcome =
  | { stored: false }
  | { stored: true; planned: false }
  | { stored: true; planned: true; blocks: number; batches: number };

/**
 * A scene batch's answer. Idempotent like `saveBatch`: a batch already done, or a run no longer
 * `lighting`, changes nothing. The last scene batch to finish (the direction row is locked, so two
 * finishing at once are serialised) runs the Breakdown and stores the v1.4 plan, the windows and
 * the lit scenes; the direction becomes `planned`, and one `write` batch row and one
 * `direction.write` job per range of blocks are added in the same transaction.
 */
export async function saveSceneBatch(input: {
  directionId: string;
  batchIndex: number;
  scenes: SceneVisual[];
}): Promise<SceneBatchOutcome> {
  return getDb().transaction(async (tx) => {
    const row = await lockOpen(tx, input.directionId, ["lighting"]);
    if (!row) return { stored: false };
    const done = await tx
      .update(directionBatch)
      .set({ status: "done", sceneVisuals: input.scenes, failure: null, finishedAt: new Date() })
      .where(
        and(
          isScene(input.directionId),
          eq(directionBatch.batchIndex, input.batchIndex),
          eq(directionBatch.status, "pending"),
        ),
      )
      .returning({ id: directionBatch.id });
    if (done.length === 0) return { stored: false };
    const batches = await tx
      .select()
      .from(directionBatch)
      .where(isScene(input.directionId))
      .orderBy(asc(directionBatch.batchIndex));
    if (batches.some((b) => b.status !== "done")) return { stored: true, planned: false };

    const context = directionContextSchema.parse(row.context);
    const shotPlan = shotPlanSchema.parse(row.shotPlan);
    const { look } = directionVisualSchema.parse(row.visual);
    const scenes = batches.flatMap((b) => sceneVisuals.parse(b.sceneVisuals ?? []));
    const [owner] = await tx
      .select({ title: project.title })
      .from(project)
      .where(eq(project.id, row.projectId))
      .limit(1);
    const craft = buildCraftPlan({ shotPlan, look, context, title: owner?.title ?? "" });
    const ranges = batchRanges(craft.plan.blocks.length);
    const visual: DirectionVisual = { look, scenes };
    await tx
      .update(direction)
      .set({
        status: "planned",
        plan: craft.plan,
        header: headerOf(craft.plan),
        breakdown: { blocks: craft.breakdown },
        visual,
        warnings: craft.plan.warnings,
        batchCount: ranges.length,
      })
      .where(eq(direction.id, row.id));
    await tx.insert(directionBatch).values(
      ranges.map((r, i) => ({
        directionId: input.directionId,
        kind: "write" as const,
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
        blocks: craft.plan.blocks.length,
        batches: ranges.length,
      },
    });
    return {
      stored: true,
      planned: true,
      blocks: craft.plan.blocks.length,
      batches: ranges.length,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Write batches                                                               */
/* -------------------------------------------------------------------------- */

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
          isWrite(input.directionId),
          eq(directionBatch.batchIndex, input.batchIndex),
          eq(directionBatch.status, "pending"),
        ),
      )
      .returning({ id: directionBatch.id });
    if (done.length === 0) return { stored: false };
    const batches = await tx
      .select()
      .from(directionBatch)
      .where(isWrite(input.directionId))
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

/**
 * What a write batch handler needs: the run, its frozen context, the saved plan and the batch;
 * for a craft run also the shot plan, the Breakdown's windows and the lit scenes.
 */
export async function loadBatchJob(directionId: string, batchIndex: number) {
  const db = getDb();
  const [row] = await db.select().from(direction).where(eq(direction.id, directionId)).limit(1);
  if (!row) return null;
  const [batch] = await db
    .select()
    .from(directionBatch)
    .where(and(isWrite(directionId), eq(directionBatch.batchIndex, batchIndex)))
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
  const craft =
    row.mode === "craft" && row.shotPlan && row.breakdown && row.visual
      ? {
          shotPlan: shotPlanSchema.parse(row.shotPlan),
          breakdown: storedBreakdownSchema.parse(row.breakdown).blocks,
          visual: directionVisualSchema.parse(row.visual),
        }
      : null;
  return {
    direction: row,
    batch,
    ownerId: owner.ownerId,
    script: version.content,
    context: directionContextSchema.parse(row.context),
    craft,
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
