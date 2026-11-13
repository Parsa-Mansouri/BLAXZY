/**
 * Jobs sent on the caller's transaction (they exist only if it commits). A failed send throws
 * `AssetInputError` (`ENQUEUE_FAILURE`), which rolls the whole change back.
 */
import type { DbTx } from "@/server/db/client";
import type { AssetKind } from "@/server/db/schema";
import {
  assetLookFix,
  assetLookGenerate,
  assetSheetFix,
  assetSheetGenerate,
  assetSheetPlan,
  enqueue,
  type JobDefinition,
  type JobInput,
} from "@/server/jobs";
import { wakeWaitingLooks } from "../designs";
import type { LookRow, SheetRow } from "../looks";
import { packKindOf } from "../packs";
import { AssetInputError } from "../service";

/** A job could not be queued: the change was rolled back with it, so trying again is safe. */
export const ENQUEUE_FAILURE = "This step could not start. Try again in a moment.";

/**
 * Sends a job on the caller's transaction (it exists only if that commits). A failed send throws
 * `AssetInputError` (`ENQUEUE_FAILURE`), which rolls the whole change back: nothing is left
 * pending without its job, and the user can simply try again.
 */
export async function enqueueOnTx<J extends JobDefinition>(
  tx: DbTx,
  job: J,
  payload: JobInput<J>,
): Promise<void> {
  try {
    await enqueue(job, payload, { tx });
  } catch (error) {
    console.error(`[assets] could not enqueue ${job.name}:`, error);
    throw new AssetInputError(ENQUEUE_FAILURE);
  }
}

/**
 * Wakes the project's waiting props on the caller's transaction (`wakeWaitingLooks`); a failed
 * send rolls the change back as `AssetInputError` (`ENQUEUE_FAILURE`).
 */
export async function wakeOnTx(tx: DbTx, projectId: string): Promise<void> {
  try {
    await wakeWaitingLooks(projectId, tx);
  } catch (error) {
    if (error instanceof AssetInputError) throw error;
    console.error(`[assets] could not wake the waiting props of ${projectId}:`, error);
    throw new AssetInputError(ENQUEUE_FAILURE);
  }
}

/**
 * Sends the job that produces a pending look, on the transaction that created it: a fix when it
 * answers a rejected parent (the handler reads the parent and its review either way; the job name
 * is for the logs).
 */
export async function enqueueLookJob(
  tx: DbTx,
  look: Pick<LookRow, "id" | "parentId">,
  mode: "generate" | "fix" = look.parentId ? "fix" : "generate",
): Promise<void> {
  await enqueueOnTx(tx, mode === "fix" ? assetLookFix : assetLookGenerate, { lookId: look.id });
}

/**
 * Sends the job that produces a pending sheet, on the transaction that created it: a location
 * pack or prop sheet is planned by its sheet maker (`asset.sheet.plan`); a character sheet is
 * generated, or fixed when it answers a rejected one.
 */
export async function enqueueSheetJob(
  tx: DbTx,
  sheet: Pick<SheetRow, "id" | "parentId">,
  kind: AssetKind,
): Promise<void> {
  const job = packKindOf(kind)
    ? assetSheetPlan
    : sheet.parentId
      ? assetSheetFix
      : assetSheetGenerate;
  await enqueueOnTx(tx, job, { sheetId: sheet.id });
}
