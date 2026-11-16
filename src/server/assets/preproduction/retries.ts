/** Running a failed look or sheet again, and starting an asset over. */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { assetLook, assetSheet } from "@/server/db/schema";
import { logProjectEvent } from "@/server/projects";
import { loadAssetState } from "../looks";
import { AssetInputError, parse } from "../service";
import type { AssetStage } from "../stage";
import { assertActive, isUuid, lockAsset } from "./access";
import { enqueueLookJob, enqueueSheetJob } from "./enqueue";
import { assetRefInput, expectedCreditsField, idSchema, userIdSchema } from "./inputs";
import { BUSY_MESSAGE } from "./messages";
import { confirmAssetSpend } from "./spend";

/**
 * Runs a failed look (the asset's latest) again: back to pending and its job re-enqueued (sent with
 * the change). The job re-runs the dami only when no prompt was stored; otherwise it requests a
 * new generation with the stored prompt (the failed generation's credits were refunded and are
 * never reused). The failed attempt's generation and failure are kept in the
 * `asset.look_retried` event (the audit trail) before the row is cleared. It spends again:
 * `expectedCredits` must be the price the user saw (see `startLookFromPrompt`).
 */
export async function retryLook(input: {
  lookId: string;
  userId: string;
  expectedCredits?: number;
}): Promise<AssetStage | null> {
  const { lookId, userId, expectedCredits } = parse(
    z.object({ lookId: idSchema, userId: userIdSchema, expectedCredits: expectedCreditsField }),
    input,
  );
  if (!isUuid(lookId)) return null;
  const look = await getDb().transaction(async (tx) => {
    const [target] = await tx
      .select({ assetId: assetLook.assetId })
      .from(assetLook)
      .where(eq(assetLook.id, lookId))
      .limit(1);
    if (!target) return null;
    const locked = await lockAsset(tx, target.assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    assertActive(row);
    const { look: latest } = await loadAssetState(tx, row);
    if (!latest || latest.id !== lookId || latest.status !== "failed") {
      throw new AssetInputError("Only the latest image that failed can be tried again.");
    }
    const confirmedCredits = await confirmAssetSpend(tx, {
      owner: locked.project,
      userId,
      step: "look",
      expectedCredits,
    });
    const [updated] = await tx
      .update(assetLook)
      .set({ status: "pending", failure: null, generationId: null, confirmedCredits })
      .where(eq(assetLook.id, lookId))
      .returning();
    if (!updated) return null;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.look_retried",
      payload: {
        assetId: row.id,
        lookId,
        previousGenerationId: latest.generationId,
        previousFailure: latest.failure,
      },
    });
    await enqueueLookJob(tx, updated);
    return "generating" as const;
  });
  return look;
}

/** Runs a failed sheet (the asset's latest, of its accepted look) again; see `retryLook`. */
export async function retrySheet(input: {
  sheetId: string;
  userId: string;
  expectedCredits?: number;
}): Promise<AssetStage | null> {
  const { sheetId, userId, expectedCredits } = parse(
    z.object({ sheetId: idSchema, userId: userIdSchema, expectedCredits: expectedCreditsField }),
    input,
  );
  if (!isUuid(sheetId)) return null;
  const sheet = await getDb().transaction(async (tx) => {
    const [target] = await tx
      .select({ assetId: assetSheet.assetId })
      .from(assetSheet)
      .where(eq(assetSheet.id, sheetId))
      .limit(1);
    if (!target) return null;
    const locked = await lockAsset(tx, target.assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    assertActive(row);
    const { look, sheet: latest } = await loadAssetState(tx, row);
    if (
      !latest ||
      latest.id !== sheetId ||
      latest.status !== "failed" ||
      look?.id !== latest.lookId ||
      look.status !== "accepted"
    ) {
      throw new AssetInputError("Only the latest sheet that failed can be tried again.");
    }
    const confirmedCredits = await confirmAssetSpend(tx, {
      owner: locked.project,
      userId,
      step: "sheet",
      expectedCredits,
    });
    const [updated] = await tx
      .update(assetSheet)
      .set({ status: "pending", failure: null, generationId: null, confirmedCredits })
      .where(eq(assetSheet.id, sheetId))
      .returning();
    if (!updated) return null;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.sheet_retried",
      payload: {
        assetId: row.id,
        sheetId,
        previousGenerationId: latest.generationId,
        previousFailure: latest.failure,
      },
    });
    await enqueueSheetJob(tx, updated, row.kind);
    return "building_sheet" as const;
  });
  return sheet;
}

/**
 * Starts an asset over: its accepted look and its sheets (accepted, in review or failed) become
 * superseded, so a new look can be uploaded or generated. Refused while something is in flight.
 */
export async function replaceLook(input: {
  assetId: string;
  userId: string;
}): Promise<AssetStage | null> {
  const { assetId, userId } = parse(assetRefInput, input);
  if (!isUuid(assetId)) return null;
  return getDb().transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    assertActive(row);
    const { state, look } = await loadAssetState(tx, row);
    if (state.busy) throw new AssetInputError(BUSY_MESSAGE);
    if (look?.status !== "accepted") {
      throw new AssetInputError("There is no accepted image to replace.");
    }
    await tx.update(assetLook).set({ status: "superseded" }).where(eq(assetLook.id, look.id));
    await tx
      .update(assetSheet)
      .set({ status: "superseded" })
      .where(
        and(
          eq(assetSheet.assetId, row.id),
          inArray(assetSheet.status, ["accepted", "in_review", "failed"]),
        ),
      );
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.look_replaced",
      payload: {
        assetId: row.id,
        lookId: look.id,
      },
    });
    return row.kind === "voice" ? "needs_recording" : "needs_image";
  });
}
