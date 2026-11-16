/**
 * Preparing blocks (binding the Director's prompts to their assets): claiming the blocks that were never prepared when Production is
 * entered, retrying a failed preparation, and reopening a finished film whose shots changed.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import {
  claimBlocksForPreparation,
  getPreviousVersion,
  listCurrentBlockStates,
  type PromptBlock,
  restartBlockPreparation,
} from "@/server/blocks";
import { type DbExecutor, type DbTx, getDb } from "@/server/db/client";
import { project, review } from "@/server/db/schema";
import { blockRevise, enqueue, productionPrepare } from "@/server/jobs";
import { productionDispatch } from "@/server/jobs/definitions";
import { logProjectEvent, reopenProduction } from "@/server/projects";
import {
  assertWritable,
  isUuid,
  lockLineage,
  openProject,
  parse,
  type ProjectRow,
  STALE_MESSAGE,
} from "./access";
import { ProductionInputError } from "./errors";
import { lineageInput } from "./inputs";
import type { BlockProductionStage } from "./stage";
import { supersedeDroppedLineageTakes, supersedeLineageTakes } from "./takes";
import { projectStages } from "./views";

/** True when this version answers a revision request on its predecessor (`block.revise`). */
async function isRevision(db: DbExecutor, block: PromptBlock): Promise<boolean> {
  const previous = await getPreviousVersion(block, db);
  if (!previous) return false;
  const [row] = await db
    .select({ id: review.id })
    .from(review)
    .where(
      and(
        eq(review.subjectType, "prompt_block"),
        eq(review.subjectId, previous.id),
        eq(review.decision, "rejected"),
        isNotNull(review.revisionRequest),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The pending block's preparation (or revision) job, on the transaction that made it pending. */
export async function enqueuePreparation(
  tx: DbTx,
  block: PromptBlock,
  revision: boolean,
): Promise<void> {
  await enqueue(revision ? blockRevise : productionPrepare, { blockId: block.id }, { tx });
}

/**
 * A finished film whose shots are not all final any more (a script edit sent some back through
 * preparation) returns to production. Runs inside the caller's transaction with the project row
 * locked. Waits while blocks are stale: the shots are being cut again, and an edit that changes no
 * shot leaves the film finished. True when this call reopened it.
 */
async function reopenIfUnfinished(
  tx: DbTx,
  row: Pick<ProjectRow, "id" | "stage">,
  userId: string | null,
  reason: string,
): Promise<boolean> {
  if (row.stage !== "done") return false;
  const states = await listCurrentBlockStates(row.id, tx);
  if (states.length === 0 || states.some((b) => b.stale)) return false;
  const { blocks, counts } = await projectStages(tx, row.id);
  if (counts.done === blocks.length) return false;
  const reopened = await reopenProduction({ projectId: row.id, reason, userId }, tx);
  if (reopened) {
    await logProjectEvent(tx, {
      projectId: row.id,
      userId,
      type: "production.reopened",
      payload: {
        reason,
        notFinal: blocks.length - counts.done,
      },
    });
  }
  return reopened;
}

/**
 * Called after the script's shots were cut again (worker): a finished film whose shots changed is
 * in production again. Idempotent. True when this call reopened it.
 */
export async function reopenProductionAfterScriptEdit(projectId: string): Promise<boolean> {
  if (!isUuid(projectId)) return false;
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ id: project.id, stage: project.stage })
      .from(project)
      .where(eq(project.id, projectId))
      .for("update");
    if (!row) return false;
    return reopenIfUnfinished(tx, row, null, "script_changed");
  });
}

/**
 * Starts preparing every current block that was never prepared (`production.prepare`), called
 * whenever Production is entered, whatever the stage. A block that changed since its takes were
 * made (a script edit, an asset merge) is such a block: its lineage's live takes are superseded
 * first. Unfinished takes of blocks the script dropped are superseded too. A finished project
 * whose shots are not all final any more is reopened (it heals a film stranded by an earlier
 * edit). No-op when everything is prepared or pending, when the project is not the user's, or
 * while blocks are stale (they wait for new blocks). `reopened` is true when this call moved the
 * project from done back to production.
 *
 * Called while rendering a page, so it stays cheap whatever the film's length: the claim is a few
 * set-based statements, and the per-block jobs are queued by one `production.dispatch` job sent
 * on the claiming transaction (claimed blocks always have their job coming).
 */
export async function ensurePrepared(
  projectId: string,
  userId: string,
): Promise<{ reopened: boolean }> {
  const outcome = await getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned) return { reopened: false };
    assertWritable(owned);
    const blocks = await claimBlocksForPreparation(projectId, tx);
    const superseded = await supersedeLineageTakes(
      tx,
      projectId,
      blocks.map((b) => b.lineageId),
    );
    const current = await listCurrentBlockStates(projectId, tx);
    const dropped = await supersedeDroppedLineageTakes(
      tx,
      projectId,
      current.map((b) => b.lineageId),
    );
    if (blocks.length > 0 || dropped > 0) {
      await logProjectEvent(tx, {
        projectId,
        userId,
        type: "production.prepare_started",
        payload: {
          blocks: blocks.length,
          takesSuperseded: superseded + dropped,
        },
      });
    }
    const reopened = await reopenIfUnfinished(tx, owned, userId, "shots_not_final");
    if (blocks.length > 0) {
      await enqueue(productionDispatch, { projectId, kind: "prepare" }, { tx });
    }
    return { reopened };
  });
  return { reopened: outcome.reopened };
}

/** Runs a failed preparation (or revision) of the lineage's current block again. */
export async function retryPreparation(input: {
  lineageId: string;
  userId: string;
}): Promise<BlockProductionStage | null> {
  const { lineageId, userId } = parse(lineageInput, input);
  const outcome = await getDb().transaction(async (tx) => {
    const locked = await lockLineage(tx, lineageId, userId);
    if (!locked) return null;
    const { block, project } = locked;
    assertWritable(project);
    if (block.stale) throw new ProductionInputError(STALE_MESSAGE);
    if (block.productionState !== "failed" || !(await restartBlockPreparation(block.id, tx))) {
      throw new ProductionInputError("Only a preparation that failed can be tried again.");
    }
    await logProjectEvent(tx, {
      projectId: project.id,
      userId,
      type: "production.preparation_retried",
      payload: {
        lineageId,
        blockId: block.id,
        previousFailure: block.productionFailure,
        previousDamiRunId: block.productionDamiRunId,
      },
    });
    await enqueuePreparation(tx, block, await isRevision(tx, block));
    return block;
  });
  if (!outcome) return null;
  return "preparing";
}
