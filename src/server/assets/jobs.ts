/**
 * Pre-production's surface for job handlers and the generation completion hook (worker only):
 * load what a job needs, store a dami's prompt, request the generation, and record the outcome,
 * always with conditional updates so a duplicate or stale run cannot overwrite newer state.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { designerFor } from "@/server/damis";
import { getDb, type DbTx } from "@/server/db/client";
import {
  asset,
  assetLook,
  assetSheet,
  generation,
  project,
  review,
  type LookSpec,
  type ProjectStyle,
  type ReviewFixRequest,
  type ReviewSubject,
  type SheetSpec,
} from "@/server/db/schema";
import { enqueueGeneration, requestGeneration, type FinishedGeneration } from "@/server/generation";
import { wakeWaitingLooks } from "./designs";
import { logEvent, type AssetRow, type LookRow, type SheetRow } from "./looks";
import { applyViewGenerationResult, enqueueAdvance } from "./packs";

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
    await logEvent(tx, row.projectId, null, "asset.look_question", {
      assetId: row.assetId,
      lookId: row.id,
      questions: input.spec.questions.filter((q) => q.blocking).map((q) => q.id),
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
    await logEvent(tx, row.projectId, null, "asset.look_ready", {
      assetId: row.assetId,
      lookId: row.id,
      usedUpload: input.fileId,
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
 * generation on the look, in one transaction with the look locked: a duplicate run finds the
 * generation and only makes sure it is queued. Throws `InsufficientCreditsError` /
 * `GenerationInputError` (nothing is created).
 */
export async function requestLookGeneration(lookId: string): Promise<RequestOutcome> {
  const outcome = await getDb().transaction(async (tx: DbTx) => {
    const [row] = await tx
      .select({ look: assetLook, asset, project })
      .from(assetLook)
      .innerJoin(asset, eq(asset.id, assetLook.assetId))
      .innerJoin(project, eq(project.id, assetLook.projectId))
      .where(eq(assetLook.id, lookId))
      .for("update", { of: assetLook });
    if (!row || row.look.status !== "pending") return { kind: "not_pending" as const };
    if (row.look.generationId) {
      return { kind: "already_requested" as const, generationId: row.look.generationId };
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
      },
      tx,
    );
    await tx.update(assetLook).set({ generationId }).where(eq(assetLook.id, lookId));
    return { kind: "requested" as const, generationId };
  });
  if (outcome.kind === "not_pending") return "not_pending";
  await enqueueGeneration(outcome.generationId);
  return outcome.kind;
}

/**
 * Requests a character sheet with its stored prompt and the files its spec names (the approved
 * board first; the previous sheet in edit mode), else the accepted look's file (label = "<name>
 * sheet"); see `requestLookGeneration`.
 */
export async function requestSheetGeneration(sheetId: string): Promise<RequestOutcome> {
  const outcome = await getDb().transaction(async (tx: DbTx) => {
    const [row] = await tx
      .select({ sheet: assetSheet, look: assetLook, asset, project })
      .from(assetSheet)
      .innerJoin(assetLook, eq(assetLook.id, assetSheet.lookId))
      .innerJoin(asset, eq(asset.id, assetSheet.assetId))
      .innerJoin(project, eq(project.id, assetSheet.projectId))
      .where(eq(assetSheet.id, sheetId))
      .for("update", { of: assetSheet });
    if (!row || row.sheet.status !== "pending") return { kind: "not_pending" as const };
    if (row.sheet.generationId) {
      return { kind: "already_requested" as const, generationId: row.sheet.generationId };
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
      },
      tx,
    );
    await tx.update(assetSheet).set({ generationId }).where(eq(assetSheet.id, sheetId));
    return { kind: "requested" as const, generationId };
  });
  if (outcome.kind === "not_pending") return "not_pending";
  await enqueueGeneration(outcome.generationId);
  return outcome.kind;
}

/** A location's look settled without a Hero: props waiting for it go ahead without it. */
async function wakeAfterLocation(assetId: string, projectId: string): Promise<void> {
  const [row] = await getDb()
    .select({ kind: asset.kind })
    .from(asset)
    .where(eq(asset.id, assetId))
    .limit(1);
  if (row && designerFor(row.kind) === "location") await wakeWaitingLooks(projectId);
}

/** pending → failed with a user-readable reason. Returns whether this call changed it. */
export async function failLook(
  lookId: string,
  failure: string,
  damiRunId?: string | null,
): Promise<boolean> {
  const failed = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(assetLook)
      .set({ status: "failed", failure, ...(damiRunId ? { damiRunId } : {}) })
      .where(and(eq(assetLook.id, lookId), eq(assetLook.status, "pending")))
      .returning();
    if (!row) return null;
    await logEvent(tx, row.projectId, null, "asset.look_failed", {
      assetId: row.assetId,
      lookId,
      failure,
    });
    return row;
  });
  if (!failed) return false;
  await wakeAfterLocation(failed.assetId, failed.projectId);
  return true;
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
    await logEvent(tx, row.projectId, null, "asset.sheet_failed", {
      assetId: row.assetId,
      sheetId,
      failure,
    });
    return true;
  });
}

/**
 * The generation completion hook: moves the pending look, sheet or sheet view that requested this
 * generation to `in_review` with its file, or to `failed` with the generation's user-readable
 * error. A settled view advances its pack.
 * Idempotent (only a pending row with this generation changes), so it may be called any number of
 * times per generation. Generations of other purposes are ignored.
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
  const settled = await getDb().transaction(async (tx) => {
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
        await logEvent(tx, projectId, null, succeeded ? "asset.look_ready" : "asset.look_failed", {
          assetId: row.assetId,
          lookId: row.id,
          generationId: g.id,
        });
      }
      return { failedLook: row && !succeeded ? row.assetId : null, advance: null };
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
      await logEvent(tx, projectId, null, succeeded ? "asset.sheet_ready" : "asset.sheet_failed", {
        assetId: row.assetId,
        sheetId: row.id,
        generationId: g.id,
      });
      return { failedLook: null, advance: null };
    }
    // Not a sheet: a view of a location pack or a prop sheet.
    const advance = await applyViewGenerationResult(tx, projectId, g.id, values);
    return { failedLook: null, advance };
  });
  if (settled.failedLook) await wakeAfterLocation(settled.failedLook, projectId);
  if (settled.advance) await enqueueAdvance(settled.advance);
}
