/**
 * Pre-production's surface for job handlers and the generation completion hook (worker only):
 * load what a job needs, store a dami's prompt, request the generation, and record the outcome,
 * always with conditional updates so a duplicate or stale run cannot overwrite newer state.
 */
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { designerFor } from "@/server/damis";
import { getDb, type DbTx } from "@/server/db/client";
import {
  asset,
  assetDetection,
  assetLook,
  assetSheet,
  generation,
  project,
  promptBlock,
  review,
  type LookSpec,
  type ProjectStyle,
  type ReviewFixRequest,
  type ReviewSubject,
  type SheetSpec,
} from "@/server/db/schema";
import { enqueueGeneration, requestGeneration, type FinishedGeneration } from "@/server/generation";
import { logProjectEvent } from "@/server/projects";
import { setSectioningState } from "@/server/blocks";
import { assetSheetViewsAdvance, enqueue, scriptDirect } from "@/server/jobs";
import { wakeWaitingLooks } from "./designs";
import type { AssetRow, LookRow, SheetRow } from "./looks";
import { applyViewGenerationResult } from "./packs";

export type AssetJobProject = { id: string; ownerId: string; style: ProjectStyle | null };
export type AssetJobReview = {
  issueCodes: string[];
  /** The catalog's fix requests (empty for older reviews, which have issue codes only). */
  fixRequests: ReviewFixRequest[];
  note: string | null;
};

export type LookJobContext = {
  look: LookRow;
  asset: AssetRow;
  project: AssetJobProject;
  /** Fixes: the rejected look and the review that rejected it. */
  parent: LookRow | null;
  review: AssetJobReview | null;
};

export type SheetJobContext = {
  sheet: SheetRow;
  /** The accepted look the sheet is built from. */
  look: LookRow;
  asset: AssetRow;
  project: AssetJobProject;
  parent: SheetRow | null;
  review: AssetJobReview | null;
};

const uuid = z.uuid();

export const GENERATION_FAILED =
  "The image could not be generated. Your credits were returned; try again.";

async function loadRejection(
  subjectType: ReviewSubject,
  subjectId: string,
): Promise<AssetJobReview | null> {
  const [row] = await getDb()
    .select({ issueCodes: review.issueCodes, fixRequests: review.fixRequests, note: review.note })
    .from(review)
    .where(
      and(
        eq(review.subjectType, subjectType),
        eq(review.subjectId, subjectId),
        eq(review.decision, "rejected"),
      ),
    )
    .orderBy(desc(review.createdAt))
    .limit(1);
  return row ?? null;
}

function jobProject(row: typeof project.$inferSelect): AssetJobProject {
  return { id: row.id, ownerId: row.ownerId, style: row.style };
}

/** Everything a look job needs, or null when the look or its project is gone or archived. */
export async function loadLookJob(lookId: string): Promise<LookJobContext | null> {
  if (!uuid.safeParse(lookId).success) return null;
  const db = getDb();
  const [row] = await db
    .select({ look: assetLook, asset, project })
    .from(assetLook)
    .innerJoin(asset, eq(asset.id, assetLook.assetId))
    .innerJoin(project, eq(project.id, assetLook.projectId))
    .where(and(eq(assetLook.id, lookId), isNull(project.archivedAt)))
    .limit(1);
  if (!row) return null;
  let parent: LookRow | null = null;
  let rejection: AssetJobReview | null = null;
  if (row.look.parentId) {
    const [p] = await db
      .select()
      .from(assetLook)
      .where(eq(assetLook.id, row.look.parentId))
      .limit(1);
    parent = p ?? null;
    rejection = await loadRejection("asset_look", row.look.parentId);
  }
  return {
    look: row.look,
    asset: row.asset,
    project: jobProject(row.project),
    parent,
    review: rejection,
  };
}

/** Everything a sheet job needs, or null when the sheet, its look or its project is gone. */
export async function loadSheetJob(sheetId: string): Promise<SheetJobContext | null> {
  if (!uuid.safeParse(sheetId).success) return null;
  const db = getDb();
  const [row] = await db
    .select({ sheet: assetSheet, look: assetLook, asset, project })
    .from(assetSheet)
    .innerJoin(assetLook, eq(assetLook.id, assetSheet.lookId))
    .innerJoin(asset, eq(asset.id, assetSheet.assetId))
    .innerJoin(project, eq(project.id, assetSheet.projectId))
    .where(and(eq(assetSheet.id, sheetId), isNull(project.archivedAt)))
    .limit(1);
  if (!row) return null;
  let parent: SheetRow | null = null;
  let rejection: AssetJobReview | null = null;
  if (row.sheet.parentId) {
    const [p] = await db
      .select()
      .from(assetSheet)
      .where(eq(assetSheet.id, row.sheet.parentId))
      .limit(1);
    parent = p ?? null;
    rejection = await loadRejection("asset_sheet", row.sheet.parentId);
  }
  return {
    sheet: row.sheet,
    look: row.look,
    asset: row.asset,
    project: jobProject(row.project),
    parent,
    review: rejection,
  };
}

/**
 * Stores a designer's answer on a pending look that has no prompt yet: the image prompt and the
 * spec (ratio, photos to attach, the spec card). False when another run did.
 */
export async function storeLookDesign(input: {
  lookId: string;
  prompt: string;
  spec: LookSpec;
  damiRunId: string;
}): Promise<boolean> {
  const updated = await getDb()
    .update(assetLook)
    .set({ prompt: input.prompt, spec: input.spec, damiRunId: input.damiRunId })
    .where(
      and(
        eq(assetLook.id, input.lookId),
        eq(assetLook.status, "pending"),
        isNull(assetLook.prompt),
      ),
    )
    .returning({ id: assetLook.id });
  return updated.length > 0;
}

/**
 * pending → needs_input: the designer asked a question it cannot design without (the prop's
 * blocking question). The spec carries the questions. False when the look moved on meanwhile.
 */
export async function markLookNeedsInput(input: {
  lookId: string;
  spec: LookSpec;
  damiRunId: string;
}): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(assetLook)
      .set({ status: "needs_input", spec: input.spec, damiRunId: input.damiRunId })
      .where(
        and(
          eq(assetLook.id, input.lookId),
          eq(assetLook.status, "pending"),
          isNull(assetLook.prompt),
        ),
      )
      .returning();
    if (!row) return false;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "asset.look_question",
      payload: {
        assetId: row.assetId,
        lookId: row.id,
        questions: input.spec.questions.filter((q) => q.blocking).map((q) => q.id),
      },
    });
    return true;
  });
}

/**
 * pending → in_review with the user's own photo as the image (a location Hero the designer took
 * as it is, `use_uploaded`): no generation, no credits. False when the look moved on meanwhile.
 */
export async function applyUploadedLook(input: {
  lookId: string;
  fileId: string;
  spec: LookSpec;
  damiRunId: string;
}): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(assetLook)
      .set({
        status: "in_review",
        fileId: input.fileId,
        spec: input.spec,
        prompt: null,
        damiRunId: input.damiRunId,
        failure: null,
      })
      .where(
        and(
          eq(assetLook.id, input.lookId),
          eq(assetLook.status, "pending"),
          isNull(assetLook.prompt),
          isNull(assetLook.generationId),
        ),
      )
      .returning();
    if (!row) return false;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "asset.look_ready",
      payload: {
        assetId: row.assetId,
        lookId: row.id,
        usedUpload: input.fileId,
      },
    });
    return true;
  });
}

/**
 * Stores a character sheet's prompt and spec (frames, edit mode, the files to attach) on a
 * pending sheet that has no prompt yet. False when another run did.
 */
export async function storeCharacterSheet(input: {
  sheetId: string;
  prompt: string;
  spec: SheetSpec;
  damiRunId: string;
}): Promise<boolean> {
  const updated = await getDb()
    .update(assetSheet)
    .set({ prompt: input.prompt, spec: input.spec, damiRunId: input.damiRunId })
    .where(
      and(
        eq(assetSheet.id, input.sheetId),
        eq(assetSheet.status, "pending"),
        isNull(assetSheet.prompt),
      ),
    )
    .returning({ id: assetSheet.id });
  return updated.length > 0;
}

type RequestOutcome = "requested" | "already_requested" | "not_pending";

/**
 * Requests the look's image with its stored prompt (label = the asset's name) and records the
 * generation on the look, in one transaction with the look locked; the generation's run job is
 * sent in that transaction too, so a generation (and its reserved credits) never exists without
 * its job. A duplicate run finds the generation and only makes sure it is queued. Throws
 * `InsufficientCreditsError` / `GenerationInputError` (nothing is created).
 */
export async function requestLookGeneration(lookId: string): Promise<RequestOutcome> {
  return getDb().transaction(async (tx: DbTx): Promise<RequestOutcome> => {
    const [row] = await tx
      .select({ look: assetLook, asset, project })
      .from(assetLook)
      .innerJoin(asset, eq(asset.id, assetLook.assetId))
      .innerJoin(project, eq(project.id, assetLook.projectId))
      .where(eq(assetLook.id, lookId))
      .for("update", { of: assetLook });
    if (!row || row.look.status !== "pending") return "not_pending";
    if (row.look.generationId) {
      await enqueueGeneration(row.look.generationId, { tx });
      return "already_requested";
    }
    if (!row.look.prompt) throw new Error(`look ${lookId} has no prompt to generate from`);
    if (!row.project.style) throw new Error(`project ${row.project.id} has no style`);
    const spec = row.look.spec;
    const { generationId } = await requestGeneration(
      {
        userId: row.project.ownerId,
        projectId: row.project.id,
        purpose: "asset_look",
        prompt: row.look.prompt,
        label: row.asset.name,
        style: row.project.style,
        // The designer chose the ratio and the photos its prompt names, in that order.
        ...(spec ? { aspectRatio: spec.aspectRatio } : {}),
        ...(spec && spec.referenceFileIds.length > 0
          ? { referenceFileIds: spec.referenceFileIds }
          : {}),
        // A new version of a rejected look (a fix or a re-roll) gets its own seed.
        ...(row.look.parentId ? { variant: row.look.id } : {}),
        // Never more than the user confirmed when this look was started.
        maxCredits: row.look.confirmedCredits,
      },
      tx,
    );
    await tx.update(assetLook).set({ generationId }).where(eq(assetLook.id, lookId));
    return "requested";
  });
}

/**
 * Requests a character sheet with its stored prompt and the files its spec names (the approved
 * board first; the previous sheet in edit mode), else the accepted look's file (label = "<name>
 * sheet"); see `requestLookGeneration`.
 */
export async function requestSheetGeneration(sheetId: string): Promise<RequestOutcome> {
  return getDb().transaction(async (tx: DbTx): Promise<RequestOutcome> => {
    const [row] = await tx
      .select({ sheet: assetSheet, look: assetLook, asset, project })
      .from(assetSheet)
      .innerJoin(assetLook, eq(assetLook.id, assetSheet.lookId))
      .innerJoin(asset, eq(asset.id, assetSheet.assetId))
      .innerJoin(project, eq(project.id, assetSheet.projectId))
      .where(eq(assetSheet.id, sheetId))
      .for("update", { of: assetSheet });
    if (!row || row.sheet.status !== "pending") return "not_pending";
    if (row.sheet.generationId) {
      await enqueueGeneration(row.sheet.generationId, { tx });
      return "already_requested";
    }
    if (!row.sheet.prompt) throw new Error(`sheet ${sheetId} has no prompt to generate from`);
    if (!row.project.style) throw new Error(`project ${row.project.id} has no style`);
    if (!row.look.fileId) throw new Error(`look ${row.look.id} has no file`);
    const files = row.sheet.spec?.referenceFileIds ?? [];
    const { generationId } = await requestGeneration(
      {
        userId: row.project.ownerId,
        projectId: row.project.id,
        purpose: "asset_sheet",
        prompt: row.sheet.prompt,
        referenceFileIds: files.length > 0 ? files : [row.look.fileId],
        label: `${row.asset.name} sheet`,
        style: row.project.style,
        // A new version of a rejected sheet (a fix or a re-roll) gets its own seed.
        ...(row.sheet.parentId ? { variant: row.sheet.id } : {}),
        maxCredits: row.sheet.confirmedCredits,
      },
      tx,
    );
    await tx.update(assetSheet).set({ generationId }).where(eq(assetSheet.id, sheetId));
    return "requested";
  });
}

/**
 * A location's look settled without a Hero: props waiting for it go ahead without it. Runs in the
 * transaction that failed the look, so the props' jobs are sent with that change.
 */
async function wakeAfterLocation(tx: DbTx, assetId: string, projectId: string): Promise<void> {
  const [row] = await tx
    .select({ kind: asset.kind })
    .from(asset)
    .where(eq(asset.id, assetId))
    .limit(1);
  if (row && designerFor(row.kind) === "location") await wakeWaitingLooks(projectId, tx);
}

/** pending → failed with a user-readable reason. Returns whether this call changed it. */
export async function failLook(
  lookId: string,
  failure: string,
  damiRunId?: string | null,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(assetLook)
      .set({ status: "failed", failure, ...(damiRunId ? { damiRunId } : {}) })
      .where(and(eq(assetLook.id, lookId), eq(assetLook.status, "pending")))
      .returning();
    if (!row) return false;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "asset.look_failed",
      payload: {
        assetId: row.assetId,
        lookId,
        failure,
      },
    });
    await wakeAfterLocation(tx, row.assetId, row.projectId);
    return true;
  });
}

export async function failSheet(
  sheetId: string,
  failure: string,
  damiRunId?: string | null,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(assetSheet)
      .set({ status: "failed", failure, ...(damiRunId ? { damiRunId } : {}) })
      .where(and(eq(assetSheet.id, sheetId), eq(assetSheet.status, "pending")))
      .returning();
    if (!row) return false;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "asset.sheet_failed",
      payload: {
        assetId: row.assetId,
        sheetId,
        failure,
      },
    });
    return true;
  });
}

/**
 * The generation completion hook: moves the pending look, sheet or sheet view that requested this
 * generation to `in_review` with its file, or to `failed` with the generation's user-readable
 * error. A settled view advances its pack (the advance job is sent in the same transaction).
 * Idempotent (only a pending row with this generation changes), so it may be called any number of
 * times per generation; a repeated call still wakes the props waiting for a failed location look
 * (the first call may have died before doing it). Generations of other purposes are ignored.
 */
export async function applyGenerationResult(g: FinishedGeneration): Promise<void> {
  if (g.purpose !== "asset_look" && g.purpose !== "asset_sheet") return;
  if (g.status !== "succeeded" && g.status !== "failed" && g.status !== "cancelled") return;
  const succeeded = g.status === "succeeded" && g.resultFileId !== null;
  const values = succeeded
    ? { status: "in_review" as const, fileId: g.resultFileId, failure: null }
    : { status: "failed" as const, failure: g.error ?? GENERATION_FAILED };
  // The project narrows the update to the (project, status) index of looks and sheets.
  const [owner] = await getDb()
    .select({ projectId: generation.projectId })
    .from(generation)
    .where(eq(generation.id, g.id))
    .limit(1);
  if (!owner) return;
  const { projectId } = owner;
  await getDb().transaction(async (tx) => {
    if (g.purpose === "asset_look") {
      const [row] = await tx
        .update(assetLook)
        .set(values)
        .where(
          and(
            eq(assetLook.projectId, projectId),
            eq(assetLook.status, "pending"),
            eq(assetLook.generationId, g.id),
          ),
        )
        .returning({ id: assetLook.id, assetId: assetLook.assetId });
      if (row) {
        await logProjectEvent(tx, {
          projectId,
          userId: null,
          type: succeeded ? "asset.look_ready" : "asset.look_failed",
          payload: {
            assetId: row.assetId,
            lookId: row.id,
            generationId: g.id,
          },
        });
        // A failed location look wakes its waiting props, in this transaction.
        if (!succeeded) await wakeAfterLocation(tx, row.assetId, projectId);
        return;
      }
      if (succeeded) return;
      // Applied before (by a run that may have died before waking): the look this generation
      // failed still wakes its waiting props (a no-op when their jobs are queued).
      const [done] = await tx
        .select({ assetId: assetLook.assetId, status: assetLook.status })
        .from(assetLook)
        .where(and(eq(assetLook.projectId, projectId), eq(assetLook.generationId, g.id)))
        .limit(1);
      if (done?.status === "failed") await wakeAfterLocation(tx, done.assetId, projectId);
      return;
    }
    const [row] = await tx
      .update(assetSheet)
      .set(values)
      .where(
        and(
          eq(assetSheet.projectId, projectId),
          eq(assetSheet.status, "pending"),
          eq(assetSheet.generationId, g.id),
        ),
      )
      .returning({ id: assetSheet.id, assetId: assetSheet.assetId });
    if (row) {
      await logProjectEvent(tx, {
        projectId,
        userId: null,
        type: succeeded ? "asset.sheet_ready" : "asset.sheet_failed",
        payload: {
          assetId: row.assetId,
          sheetId: row.id,
          generationId: g.id,
        },
      });
      return;
    }
    // Not a sheet: a view of a location pack or a prop sheet. Its pack advances: the job is sent
    // with the view's update, so a crash cannot lose it (a repeated call finds no pending view).
    const advance = await applyViewGenerationResult(tx, projectId, g.id, values);
    if (advance) await enqueue(assetSheetViewsAdvance, { sheetId: advance }, { tx });
  });
}

/**
 * After a correction round's detection: marks sectioning running for the version and queues the
 * re-cut, in one transaction (the state never says "running" without its job).
 */
export async function queueResection(projectId: string, scriptVersionId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await setSectioningState({ projectId, state: "running", scriptVersionId, failure: null }, tx);
    await enqueue(scriptDirect, { scriptVersionId, resection: true }, { tx });
  });
}

/** When the project's latest asset detection was applied, or null (none yet). */
export async function latestDetectionAt(projectId: string): Promise<Date | null> {
  const [latest] = await getDb()
    .select({ createdAt: assetDetection.createdAt })
    .from(assetDetection)
    .where(eq(assetDetection.projectId, projectId))
    .orderBy(desc(assetDetection.createdAt))
    .limit(1);
  return latest?.createdAt ?? null;
}

/** The part of `project.stageState.sectioning` read here (written by the blocks service). */
const sectioningRecord = z.object({ state: z.string(), scriptVersionId: z.string() });

/**
 * After a correction round's detection was applied: whether the project's blocks still have to be
 * cut again for it. True when some current block is older than the latest detection (every
 * re-cut replaces all current blocks) or there are none, unless sectioning of this version
 * failed (the user retries that). A handler retry uses it to re-issue the sectioning job the
 * first attempt may not have sent.
 */
export async function sectioningOwedAfterDetection(
  projectId: string,
  scriptVersionId: string,
): Promise<boolean> {
  const db = getDb();
  const latest = await latestDetectionAt(projectId);
  if (!latest) return false;
  const [owner] = await db
    .select({ stageState: project.stageState })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  const record = sectioningRecord.safeParse(owner?.stageState.sectioning);
  if (
    record.success &&
    record.data.state === "failed" &&
    record.data.scriptVersionId === scriptVersionId
  ) {
    return false;
  }
  const current = and(eq(promptBlock.projectId, projectId), isNull(promptBlock.supersededAt));
  const [any] = await db.select({ id: promptBlock.id }).from(promptBlock).where(current).limit(1);
  if (!any) return true;
  const [older] = await db
    .select({ id: promptBlock.id })
    .from(promptBlock)
    .where(and(current, lt(promptBlock.createdAt, latest)))
    .limit(1);
  return older !== undefined;
}
