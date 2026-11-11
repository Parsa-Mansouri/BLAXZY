/**
 * Pre-production (Output_030): each asset gets an image (a "look": uploaded or generated, then
 * reviewed) and, once a look is accepted, a sheet built from it (generated, then reviewed). Voices
 * get a recording instead, accepted on upload, with no sheet.
 *
 * Every function takes the acting user and returns null (or false) when the project or asset is
 * missing, archived or not theirs; input the user can fix throws `AssetInputError` with a
 * user-safe message. Work that takes time (damis, generations) runs in jobs, enqueued after the
 * transaction that creates the look or sheet has committed. Nothing is overwritten or deleted:
 * decisions change statuses, and new attempts are new versions.
 */
import { and, asc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { rewriteAssetRefs } from "@/server/blocks";
import {
  ASSET_QUESTIONS,
  ASSET_SLUG_PATTERN,
  LOOK_ISSUE_CODES,
  SHEET_ISSUE_CODES,
} from "@/server/damis";
import { getDb, type DbExecutor, type DbTx } from "@/server/db/client";
import {
  ASSET_KINDS,
  asset,
  assetLook,
  assetSheet,
  project,
  review,
  WIZARD_STAGES,
  type AssetKind,
  type WizardStage,
} from "@/server/db/schema";
import {
  assetLookFix,
  assetLookGenerate,
  assetSheetFix,
  assetSheetGenerate,
  enqueue,
} from "@/server/jobs";
import { advanceStage, canOpenStage } from "@/server/projects";
import { FILE_PURPOSES, getOwnedFileInfo, type FilePurpose } from "@/server/storage";
import {
  latestByAsset,
  listLookViews,
  listSheetViews,
  loadAssetState,
  loadLookView,
  logEvent,
  newestLookWithStatus,
  newestSheetWithStatus,
  type AssetRow,
  type LookRow,
  type LookView,
  type SheetRow,
  type SheetView,
} from "./looks";
import { AssetInputError, listAssets, parse, type Asset } from "./service";
import { deriveAssetState, type AssetStage } from "./stage";

export type AssetCard = { asset: Asset; stage: AssetStage; thumbnailFileId: string | null };

export type AssetDetail = {
  asset: Asset;
  stage: AssetStage;
  /** Newest first, at most 20. */
  looks: LookView[];
  /** Newest first, at most 20. */
  sheets: SheetView[];
  /** A look or sheet is being produced; nothing new can be started. */
  busy: boolean;
};

export type PreProductionOverview = {
  /** Only kinds that have active assets, in the order of `ASSET_KINDS`. */
  kinds: { kind: AssetKind; total: number; ready: number }[];
  total: number;
  ready: number;
  /** Every active asset is ready and the project is in pre-production. */
  canComplete: boolean;
};

/** Longest prompt a user may write for a look (the asset-prompt-writer's limit). */
export const MAX_LOOK_PROMPT_LENGTH = 4000;
/** Longest answer to one guided question (the asset-prompt-writer's limit). */
export const MAX_GUIDED_ANSWER_LENGTH = 1000;
export const MAX_REVIEW_NOTE_LENGTH = 2000;
export const MAX_ASSET_NAME_LENGTH = 200;
export const MAX_ASSET_DESCRIPTION_LENGTH = 4000;
export const DEFAULT_CARD_PAGE_SIZE = 24;
export const MAX_CARD_PAGE_SIZE = 100;

const BUSY_MESSAGE = "This asset is still being worked on. Wait for it to finish, then try again.";
const REMOVED_MESSAGE = "This asset was removed from the project.";
const STAGE_MESSAGE = "Accept a script before starting pre-production.";
const ENQUEUE_FAILURE = "We could not start this step. Try again in a moment.";

const uuid = z.uuid();
const isUuid = (value: string) => uuid.safeParse(value).success;
const userIdSchema = z.string().trim().min(1).max(128);

/* ------------------------------------------------------------------------------------------ */
/* Input schemas                                                                               */
/* ------------------------------------------------------------------------------------------ */

const assetRefInput = z.object({ assetId: z.string(), userId: userIdSchema });

const uploadInput = assetRefInput.extend({ fileId: z.string() });

const promptInput = assetRefInput.extend({
  prompt: z
    .string({ error: "Describe the image you want." })
    .trim()
    .min(3, "Describe the image you want.")
    .max(
      MAX_LOOK_PROMPT_LENGTH,
      `Keep the description under ${MAX_LOOK_PROMPT_LENGTH} characters.`,
    ),
});

const guidedInput = assetRefInput.extend({
  answers: z.record(
    z.string().max(64, "That question is not one we asked."),
    z
      .string({ error: "Answers must be text." })
      .max(
        MAX_GUIDED_ANSWER_LENGTH,
        `Keep each answer under ${MAX_GUIDED_ANSWER_LENGTH} characters.`,
      ),
    { error: "Answer the questions first." },
  ),
});

const noteSchema = z
  .string()
  .trim()
  .max(MAX_REVIEW_NOTE_LENGTH, `Keep the note under ${MAX_REVIEW_NOTE_LENGTH} characters.`)
  .optional();

const lookReviewInput = z.object({
  lookId: z.string(),
  userId: userIdSchema,
  decision: z.enum(["accepted", "rejected"], { error: "Accept or reject the image." }),
  issueCodes: z
    .array(z.enum(LOOK_ISSUE_CODES, { error: "Pick issues from the list." }))
    .max(LOOK_ISSUE_CODES.length)
    .optional(),
  note: noteSchema,
});

const sheetReviewInput = z.object({
  sheetId: z.string(),
  userId: userIdSchema,
  decision: z.enum(["accepted", "rejected"], { error: "Accept or reject the sheet." }),
  issueCodes: z
    .array(z.enum(SHEET_ISSUE_CODES, { error: "Pick issues from the list." }))
    .max(SHEET_ISSUE_CODES.length)
    .optional(),
  note: noteSchema,
});

const nameSchema = z
  .string({ error: "Give the asset a name." })
  .trim()
  .min(1, "Give the asset a name.")
  .max(MAX_ASSET_NAME_LENGTH, `Keep the name under ${MAX_ASSET_NAME_LENGTH} characters.`);
const descriptionSchema = z
  .string()
  .trim()
  .max(
    MAX_ASSET_DESCRIPTION_LENGTH,
    `Keep the description under ${MAX_ASSET_DESCRIPTION_LENGTH} characters.`,
  );

const addInput = z.object({
  projectId: z.string(),
  userId: userIdSchema,
  kind: z.enum(ASSET_KINDS, { error: "Choose what kind of asset this is." }),
  name: nameSchema,
  description: descriptionSchema.optional(),
});

const updateInput = assetRefInput.extend({
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
});

const mergeInput = z.object({ keepId: z.string(), mergeId: z.string(), userId: userIdSchema });

const cardsInput = z.object({
  kind: z.enum(ASSET_KINDS, { error: "Choose a kind of asset." }),
  limit: z.number().int().min(1).max(MAX_CARD_PAGE_SIZE).default(DEFAULT_CARD_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
});

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

type ProjectRow = typeof project.$inferSelect;

function assertPreProductionOpen(row: Pick<ProjectRow, "stage">): void {
  const wizardStage = (WIZARD_STAGES as readonly string[]).includes(row.stage);
  if (wizardStage && !canOpenStage(row, "pre_production" satisfies WizardStage)) {
    throw new AssetInputError(STAGE_MESSAGE);
  }
}

const ownedProjectWhere = (projectId: string, userId: string) =>
  and(eq(project.id, projectId), eq(project.ownerId, userId), isNull(project.archivedAt));

/** The user's project with pre-production open, or null when not theirs. */
async function openProject(
  db: DbExecutor,
  projectId: string,
  userId: string,
  lock = false,
): Promise<ProjectRow | null> {
  if (!isUuid(projectId)) return null;
  const query = db.select().from(project).where(ownedProjectWhere(projectId, userId)).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) return null;
  assertPreProductionOpen(row);
  return row;
}

/** The asset and its project, the asset row locked, when the user owns it and the stage is open. */
async function lockAsset(
  tx: DbTx,
  assetId: string,
  userId: string,
): Promise<{ asset: AssetRow; project: ProjectRow } | null> {
  if (!isUuid(assetId)) return null;
  const [row] = await tx
    .select({ asset, project })
    .from(asset)
    .innerJoin(project, eq(project.id, asset.projectId))
    .where(and(eq(asset.id, assetId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .for("update", { of: asset });
  if (!row) return null;
  assertPreProductionOpen(row.project);
  return row;
}

function assertActive(row: AssetRow): void {
  if (row.status !== "active") throw new AssetInputError(REMOVED_MESSAGE);
}

async function nextLookNumber(tx: DbTx, assetId: string): Promise<number> {
  const [row] = await tx
    .select({ n: max(assetLook.versionNumber) })
    .from(assetLook)
    .where(eq(assetLook.assetId, assetId));
  return (row?.n ?? 0) + 1;
}

async function nextSheetNumber(tx: DbTx, assetId: string): Promise<number> {
  const [row] = await tx
    .select({ n: max(assetSheet.versionNumber) })
    .from(assetSheet)
    .where(eq(assetSheet.assetId, assetId));
  return (row?.n ?? 0) + 1;
}

async function insertLook(
  tx: DbTx,
  values: Omit<typeof assetLook.$inferInsert, "versionNumber">,
): Promise<LookRow> {
  const [row] = await tx
    .insert(assetLook)
    .values({ ...values, versionNumber: await nextLookNumber(tx, values.assetId) })
    .returning();
  if (!row) throw new Error("asset_look insert returned no row");
  return row;
}

async function insertSheet(
  tx: DbTx,
  values: Omit<typeof assetSheet.$inferInsert, "versionNumber">,
): Promise<SheetRow> {
  const [row] = await tx
    .insert(assetSheet)
    .values({ ...values, versionNumber: await nextSheetNumber(tx, values.assetId) })
    .returning();
  if (!row) throw new Error("asset_sheet insert returned no row");
  return row;
}

/** Fails a pending look or sheet whose job could not be queued, so the user can retry it. */
async function markEnqueueFailed(kind: "look" | "sheet", id: string): Promise<void> {
  const db = getDb();
  if (kind === "look") {
    await db
      .update(assetLook)
      .set({ status: "failed", failure: ENQUEUE_FAILURE })
      .where(and(eq(assetLook.id, id), eq(assetLook.status, "pending")));
  } else {
    await db
      .update(assetSheet)
      .set({ status: "failed", failure: ENQUEUE_FAILURE })
      .where(and(eq(assetSheet.id, id), eq(assetSheet.status, "pending")));
  }
}

/** Enqueues the job that produces a pending look (a fix when it answers a rejected parent). */
async function enqueueLookJob(look: Pick<LookRow, "id" | "parentId">): Promise<void> {
  const job = look.parentId ? assetLookFix : assetLookGenerate;
  try {
    await enqueue(job, { lookId: look.id });
  } catch (error) {
    console.error(`[assets] could not enqueue ${job.name} for ${look.id}:`, error);
    await markEnqueueFailed("look", look.id);
  }
}

async function enqueueSheetJob(sheet: Pick<SheetRow, "id" | "parentId">): Promise<void> {
  const job = sheet.parentId ? assetSheetFix : assetSheetGenerate;
  try {
    await enqueue(job, { sheetId: sheet.id });
  } catch (error) {
    console.error(`[assets] could not enqueue ${job.name} for ${sheet.id}:`, error);
    await markEnqueueFailed("sheet", sheet.id);
  }
}

/** Checks guided answers against the asset kind's questions; returns the trimmed, non-empty ones. */
export function validateGuidedAnswers(
  kind: AssetKind,
  answers: Record<string, string>,
): Record<string, string> {
  const questions = ASSET_QUESTIONS[kind];
  if (questions.length === 0) {
    throw new AssetInputError("This kind of asset has no questions. Upload a file instead.");
  }
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const id of Object.keys(answers)) {
    if (!byId.has(id))
      throw new AssetInputError("One of the answers is for a question we did not ask.");
  }
  const result: Record<string, string> = {};
  for (const question of questions) {
    const value = (answers[question.id] ?? "").trim();
    if (value.length === 0) {
      if (!question.optional) throw new AssetInputError(`Answer “${question.label}”.`);
      continue;
    }
    if (
      question.kind === "choice" &&
      !(question.options ?? []).some((option) => option.value === value)
    ) {
      throw new AssetInputError(`Pick one of the offered answers for “${question.label}”.`);
    }
    result[question.id] = value;
  }
  return result;
}

/** Which purpose an asset's upload must match, and what the user is told otherwise. */
function uploadRule(kind: AssetKind): { purpose: FilePurpose; message: string } {
  return kind === "voice"
    ? { purpose: "asset_audio", message: "Upload the voice as an .mp3, .wav or .m4a file." }
    : { purpose: "asset_image", message: "Upload the image as a .png, .jpg or .webp file." };
}

/* ------------------------------------------------------------------------------------------ */
/* Reading                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** Readiness of every active asset (bounded by the project's asset count). */
async function readiness(
  db: DbExecutor,
  projectId: string,
): Promise<{ kind: AssetKind; ready: boolean }[]> {
  const active = await db
    .select({ id: asset.id, kind: asset.kind })
    .from(asset)
    .where(and(eq(asset.projectId, projectId), eq(asset.status, "active")));
  const { looks, sheets } = await latestByAsset(
    db,
    active.map((a) => a.id),
  );
  return active.map((a) => ({
    kind: a.kind,
    ready:
      deriveAssetState(a.kind, looks.get(a.id) ?? null, sheets.get(a.id) ?? null).stage === "ready",
  }));
}

function summarise(
  rows: { kind: AssetKind; ready: boolean }[],
  stage: string,
): PreProductionOverview {
  const kinds = ASSET_KINDS.map((kind) => {
    const ofKind = rows.filter((r) => r.kind === kind);
    return { kind, total: ofKind.length, ready: ofKind.filter((r) => r.ready).length };
  }).filter((k) => k.total > 0);
  const total = rows.length;
  const ready = rows.filter((r) => r.ready).length;
  return {
    kinds,
    total,
    ready,
    canComplete: stage === "pre_production" && total > 0 && ready === total,
  };
}

/** Per-kind totals and readiness of the project's active assets. */
export async function getPreProductionOverview(
  projectId: string,
  userId: string,
): Promise<PreProductionOverview | null> {
  const db = getDb();
  const owned = await openProject(db, projectId, userId);
  if (!owned) return null;
  return summarise(await readiness(db, projectId), owned.stage);
}

/**
 * One page of the active assets of a kind, in display order, each with its stage and a thumbnail:
 * the accepted sheet, else the accepted look, else the newest look in review.
 */
export async function listAssetCards(
  projectId: string,
  userId: string,
  opts: { kind: AssetKind; limit?: number; cursor?: string | null },
): Promise<{ items: AssetCard[]; nextCursor: string | null } | null> {
  const { kind, limit, cursor } = parse(cardsInput, opts);
  const db = getDb();
  if (!(await openProject(db, projectId, userId))) return null;
  const page = await listAssets(projectId, userId, { kind, limit, cursor });
  if (!page) return null;
  const ids = page.items.map((a) => a.id);
  const { looks, sheets } = await latestByAsset(db, ids);
  const acceptedSheets = await newestSheetWithStatus(db, ids, "accepted");
  const acceptedLooks = await newestLookWithStatus(db, ids, "accepted");
  const inReview = await newestLookWithStatus(db, ids, "in_review");
  const items = page.items.map((a): AssetCard => {
    const thumbnailFileId =
      acceptedSheets.get(a.id)?.fileId ??
      acceptedLooks.get(a.id)?.fileId ??
      inReview.get(a.id)?.fileId ??
      null;
    const stage = deriveAssetState(a.kind, looks.get(a.id) ?? null, sheets.get(a.id) ?? null).stage;
    // A voice's "look" is a recording: no thumbnail.
    return { asset: a, stage, thumbnailFileId: a.kind === "voice" ? null : thumbnailFileId };
  });
  return { items, nextCursor: page.nextCursor };
}

/** One asset (removed ones too) with its stage and its newest looks and sheets. */
export async function getAssetDetail(assetId: string, userId: string): Promise<AssetDetail | null> {
  if (!isUuid(assetId)) return null;
  const db = getDb();
  const [row] = await db
    .select({ asset, project })
    .from(asset)
    .innerJoin(project, eq(project.id, asset.projectId))
    .where(and(eq(asset.id, assetId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .limit(1);
  if (!row) return null;
  assertPreProductionOpen(row.project);
  const looks = await listLookViews(db, assetId);
  const sheets = await listSheetViews(db, assetId);
  const state = deriveAssetState(row.asset.kind, looks[0] ?? null, sheets[0] ?? null);
  return { asset: row.asset, stage: state.stage, looks, sheets, busy: state.busy };
}

/* ------------------------------------------------------------------------------------------ */
/* Starting a look                                                                             */
/* ------------------------------------------------------------------------------------------ */

/** Refuses a new look unless the asset is waiting for one (or its last look failed). */
async function assertCanStartLook(tx: DbTx, row: AssetRow): Promise<void> {
  assertActive(row);
  const { state } = await loadAssetState(tx, row);
  if (state.busy) throw new AssetInputError(BUSY_MESSAGE);
  if (row.kind === "voice") return; // a new recording replaces the accepted one
  switch (state.stage) {
    case "needs_image":
      return;
    case "failed":
      if (state.failed === "look") return;
      break;
    case "look_review":
      throw new AssetInputError("Review the current image first, then try another one.");
    default:
      break;
  }
  throw new AssetInputError("This asset already has an accepted image. Replace it to start over.");
}

/**
 * Uses an uploaded file as the asset's look. Image assets: a ready image the user owns, put in
 * review at once. Voices: a ready audio file, accepted at once (no sheet); it replaces any
 * previous recording.
 */
export async function startLookFromUpload(input: {
  assetId: string;
  userId: string;
  fileId: string;
}): Promise<LookView | null> {
  const { assetId, userId, fileId } = parse(uploadInput, input);
  if (!isUuid(assetId)) return null;
  const notUsable = new AssetInputError("That file is not available. Upload it again.");
  if (!isUuid(fileId)) throw notUsable;
  const file = await getOwnedFileInfo(fileId, userId);
  if (!file || file.status !== "ready") throw notUsable;

  const created = await getDb().transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    if (file.projectId !== null && file.projectId !== row.projectId) throw notUsable;
    const rule = uploadRule(row.kind);
    const allowed: Readonly<Record<string, readonly string[]>> = FILE_PURPOSES[rule.purpose].types;
    if (
      !(file.mimeType in allowed) ||
      (file.sizeBytes ?? 0) > FILE_PURPOSES[rule.purpose].maxBytes
    ) {
      throw new AssetInputError(rule.message);
    }
    await assertCanStartLook(tx, row);
    const now = new Date();
    if (row.kind === "voice") {
      await tx
        .update(assetLook)
        .set({ status: "superseded" })
        .where(and(eq(assetLook.assetId, row.id), eq(assetLook.status, "accepted")));
      const look = await insertLook(tx, {
        assetId: row.id,
        projectId: row.projectId,
        source: "uploaded",
        status: "accepted",
        fileId,
        createdBy: userId,
        decidedAt: now,
      });
      await logEvent(tx, row.projectId, userId, "asset.look_accepted", {
        assetId: row.id,
        lookId: look.id,
        source: "uploaded",
      });
      return look;
    }
    const look = await insertLook(tx, {
      assetId: row.id,
      projectId: row.projectId,
      source: "uploaded",
      status: "in_review",
      fileId,
      createdBy: userId,
    });
    await logEvent(tx, row.projectId, userId, "asset.look_started", {
      assetId: row.id,
      lookId: look.id,
      source: "uploaded",
    });
    return look;
  });
  if (!created) return null;
  return loadLookView(getDb(), created.id);
}

async function startGeneratedLook(
  assetId: string,
  userId: string,
  values: { userPrompt?: string; guidedAnswers?: Record<string, string> },
  answersFor?: (kind: AssetKind) => Record<string, string>,
): Promise<LookView | null> {
  if (!isUuid(assetId)) return null;
  const created = await getDb().transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    if (row.kind === "voice") {
      throw new AssetInputError("Voices are recorded, not generated. Upload a recording.");
    }
    const guidedAnswers = answersFor ? answersFor(row.kind) : values.guidedAnswers;
    await assertCanStartLook(tx, row);
    const look = await insertLook(tx, {
      assetId: row.id,
      projectId: row.projectId,
      source: "generated",
      status: "pending",
      userPrompt: values.userPrompt ?? null,
      guidedAnswers: guidedAnswers ?? null,
      createdBy: userId,
    });
    await logEvent(tx, row.projectId, userId, "asset.look_started", {
      assetId: row.id,
      lookId: look.id,
      source: guidedAnswers ? "guided" : "prompt",
    });
    return look;
  });
  if (!created) return null;
  await enqueueLookJob(created);
  return loadLookView(getDb(), created.id);
}

/** Generates a look from the user's own description: look pending, `asset.look.generate`. */
export async function startLookFromPrompt(input: {
  assetId: string;
  userId: string;
  prompt: string;
}): Promise<LookView | null> {
  const { assetId, userId, prompt } = parse(promptInput, input);
  return startGeneratedLook(assetId, userId, { userPrompt: prompt });
}

/**
 * Generates a look from answers to `ASSET_QUESTIONS[kind]` (keyed by question id; a choice answer
 * is the option's value): look pending, `asset.look.generate`.
 */
export async function startLookFromGuided(input: {
  assetId: string;
  userId: string;
  answers: Record<string, string>;
}): Promise<LookView | null> {
  const { assetId, userId, answers } = parse(guidedInput, input);
  return startGeneratedLook(assetId, userId, {}, (kind) => validateGuidedAnswers(kind, answers));
}

/* ------------------------------------------------------------------------------------------ */
/* Reviews                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const NEEDS_REASON = "Tell us what is wrong: pick an issue or write a note.";
const NOT_IN_REVIEW = "This is no longer waiting for review. Reload the page.";

/**
 * Accepts or rejects a look in review (the asset's latest), recording the review with the dami
 * run that wrote its prompt. Accepted: any earlier accepted look and sheet are superseded and a
 * sheet is started (`asset.sheet.generate`). Rejected (needs an issue or a note): an uploaded
 * look sends the asset back to needs_image; a generated one gets a fixed look (`asset.look.fix`).
 */
export async function submitLookReview(input: {
  lookId: string;
  userId: string;
  decision: "accepted" | "rejected";
  issueCodes?: string[];
  note?: string;
}): Promise<AssetStage | null> {
  const parsed = parse(lookReviewInput, input);
  const { lookId, userId, decision } = parsed;
  const issueCodes = [...new Set(parsed.issueCodes ?? [])];
  const note = parsed.note ? parsed.note : null;
  if (!isUuid(lookId)) return null;
  if (decision === "rejected" && issueCodes.length === 0 && !note) {
    throw new AssetInputError(NEEDS_REASON);
  }
  const outcome = await getDb().transaction(async (tx) => {
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
    if (!latest || latest.id !== lookId || latest.status !== "in_review") {
      throw new AssetInputError(NOT_IN_REVIEW);
    }
    const now = new Date();
    await tx.insert(review).values({
      projectId: row.projectId,
      userId,
      subjectType: "asset_look",
      subjectId: lookId,
      decision,
      issueCodes: decision === "rejected" ? issueCodes : [],
      note,
      damiRunId: latest.damiRunId,
    });

    if (decision === "rejected") {
      await tx
        .update(assetLook)
        .set({ status: "rejected", decidedAt: now })
        .where(eq(assetLook.id, lookId));
      await logEvent(tx, row.projectId, userId, "asset.look_rejected", {
        assetId: row.id,
        lookId,
        issueCodes,
      });
      if (latest.source === "uploaded") return { stage: "needs_image" as const, job: null };
      const next = await insertLook(tx, {
        assetId: row.id,
        projectId: row.projectId,
        parentId: lookId,
        source: "generated",
        status: "pending",
        userPrompt: latest.userPrompt,
        guidedAnswers: latest.guidedAnswers,
        createdBy: userId,
      });
      return { stage: "generating" as const, job: { kind: "look" as const, row: next } };
    }

    await tx
      .update(assetLook)
      .set({ status: "superseded" })
      .where(
        and(
          eq(assetLook.assetId, row.id),
          eq(assetLook.status, "accepted"),
          ne(assetLook.id, lookId),
        ),
      );
    await tx
      .update(assetSheet)
      .set({ status: "superseded" })
      .where(
        and(
          eq(assetSheet.assetId, row.id),
          inArray(assetSheet.status, ["accepted", "in_review", "failed"]),
        ),
      );
    await tx
      .update(assetLook)
      .set({ status: "accepted", decidedAt: now })
      .where(eq(assetLook.id, lookId));
    const sheet = await insertSheet(tx, {
      assetId: row.id,
      projectId: row.projectId,
      lookId,
      status: "pending",
    });
    await logEvent(tx, row.projectId, userId, "asset.look_accepted", {
      assetId: row.id,
      lookId,
      source: latest.source,
      sheetId: sheet.id,
    });
    return { stage: "building_sheet" as const, job: { kind: "sheet" as const, row: sheet } };
  });
  if (!outcome) return null;
  if (outcome.job?.kind === "look") await enqueueLookJob(outcome.job.row);
  if (outcome.job?.kind === "sheet") await enqueueSheetJob(outcome.job.row);
  return outcome.stage;
}

/**
 * Accepts or rejects a sheet in review (the asset's latest, built from its accepted look). Accepted:
 * the asset is ready. Rejected (needs an issue or a note): a fixed sheet is started
 * (`asset.sheet.fix`).
 */
export async function submitSheetReview(input: {
  sheetId: string;
  userId: string;
  decision: "accepted" | "rejected";
  issueCodes?: string[];
  note?: string;
}): Promise<AssetStage | null> {
  const parsed = parse(sheetReviewInput, input);
  const { sheetId, userId, decision } = parsed;
  const issueCodes = [...new Set(parsed.issueCodes ?? [])];
  const note = parsed.note ? parsed.note : null;
  if (!isUuid(sheetId)) return null;
  if (decision === "rejected" && issueCodes.length === 0 && !note) {
    throw new AssetInputError(NEEDS_REASON);
  }
  const outcome = await getDb().transaction(async (tx) => {
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
      // A ready asset's accepted sheet can still be sent back (the Review All pass).
      !(
        latest.status === "in_review" ||
        (decision === "rejected" && latest.status === "accepted")
      ) ||
      look?.id !== latest.lookId ||
      look.status !== "accepted"
    ) {
      throw new AssetInputError(NOT_IN_REVIEW);
    }
    const now = new Date();
    await tx.insert(review).values({
      projectId: row.projectId,
      userId,
      subjectType: "asset_sheet",
      subjectId: sheetId,
      decision,
      issueCodes: decision === "rejected" ? issueCodes : [],
      note,
      damiRunId: latest.damiRunId,
    });
    if (decision === "rejected") {
      await tx
        .update(assetSheet)
        .set({ status: "rejected", decidedAt: now })
        .where(eq(assetSheet.id, sheetId));
      const next = await insertSheet(tx, {
        assetId: row.id,
        projectId: row.projectId,
        lookId: latest.lookId,
        parentId: sheetId,
        status: "pending",
      });
      await logEvent(tx, row.projectId, userId, "asset.sheet_rejected", {
        assetId: row.id,
        sheetId,
        nextSheetId: next.id,
        issueCodes,
      });
      return { stage: "building_sheet" as const, next };
    }
    await tx
      .update(assetSheet)
      .set({ status: "superseded" })
      .where(
        and(
          eq(assetSheet.assetId, row.id),
          eq(assetSheet.status, "accepted"),
          ne(assetSheet.id, sheetId),
        ),
      );
    await tx
      .update(assetSheet)
      .set({ status: "accepted", decidedAt: now })
      .where(eq(assetSheet.id, sheetId));
    await logEvent(tx, row.projectId, userId, "asset.sheet_accepted", {
      assetId: row.id,
      sheetId,
      lookId: latest.lookId,
    });
    return { stage: "ready" as const, next: null };
  });
  if (!outcome) return null;
  if (outcome.next) await enqueueSheetJob(outcome.next);
  return outcome.stage;
}

/* ------------------------------------------------------------------------------------------ */
/* Retries and starting over                                                                   */
/* ------------------------------------------------------------------------------------------ */

/**
 * Runs a failed look (the asset's latest) again: back to pending and its job re-enqueued. The job
 * re-runs the dami only when no prompt was stored; otherwise it requests a new generation with the
 * stored prompt (the failed generation's credits were refunded and are never reused).
 */
export async function retryLook(input: {
  lookId: string;
  userId: string;
}): Promise<AssetStage | null> {
  const { lookId, userId } = parse(z.object({ lookId: z.string(), userId: userIdSchema }), input);
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
    const [updated] = await tx
      .update(assetLook)
      .set({ status: "pending", failure: null, generationId: null })
      .where(eq(assetLook.id, lookId))
      .returning();
    await logEvent(tx, row.projectId, userId, "asset.look_retried", { assetId: row.id, lookId });
    return updated ?? null;
  });
  if (!look) return null;
  await enqueueLookJob(look);
  return "generating";
}

/** Runs a failed sheet (the asset's latest, of its accepted look) again; see `retryLook`. */
export async function retrySheet(input: {
  sheetId: string;
  userId: string;
}): Promise<AssetStage | null> {
  const { sheetId, userId } = parse(z.object({ sheetId: z.string(), userId: userIdSchema }), input);
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
    const [updated] = await tx
      .update(assetSheet)
      .set({ status: "pending", failure: null, generationId: null })
      .where(eq(assetSheet.id, sheetId))
      .returning();
    await logEvent(tx, row.projectId, userId, "asset.sheet_retried", {
      assetId: row.id,
      sheetId,
    });
    return updated ?? null;
  });
  if (!sheet) return null;
  await enqueueSheetJob(sheet);
  return "building_sheet";
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
    await logEvent(tx, row.projectId, userId, "asset.look_replaced", {
      assetId: row.id,
      lookId: look.id,
    });
    return row.kind === "voice" ? "needs_recording" : "needs_image";
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Managing assets                                                                             */
/* ------------------------------------------------------------------------------------------ */

/** `Old Tomas (the keeper)` → `old-tomas-the-keeper` (empty when nothing usable is left). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

async function freeSlug(tx: DbTx, projectId: string, kind: AssetKind, name: string) {
  const base = slugify(name) || kind;
  const taken = await tx
    .select({ slug: asset.slug })
    .from(asset)
    .where(
      and(
        eq(asset.projectId, projectId),
        eq(asset.kind, kind),
        sql`(${asset.slug} = ${base} or ${asset.slug} like ${`${base}-%`})`,
      ),
    );
  const used = new Set(taken.map((t) => t.slug));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Adds an asset by hand (origin manual; detection never changes or removes it). */
export async function addAsset(input: {
  projectId: string;
  userId: string;
  kind: AssetKind;
  name: string;
  description?: string;
}): Promise<Asset | null> {
  const { projectId, userId, kind, name, description } = parse(addInput, input);
  return getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned) return null;
    const slug = await freeSlug(tx, projectId, kind, name);
    if (!ASSET_SLUG_PATTERN.test(slug))
      throw new AssetInputError("Use letters or digits in the name.");
    const [last] = await tx
      .select({ order: max(asset.displayOrder) })
      .from(asset)
      .where(eq(asset.projectId, projectId));
    const [row] = await tx
      .insert(asset)
      .values({
        projectId,
        kind,
        name,
        slug,
        description: description ? description : null,
        status: "active",
        origin: "manual",
        displayOrder: (last?.order ?? -1) + 1,
      })
      .returning();
    if (!row) throw new Error("asset insert returned no row");
    await logEvent(tx, projectId, userId, "asset.added", { assetId: row.id, kind, slug });
    return row;
  });
}

/** Renames an asset or changes its description (its slug, the stable key, stays). */
export async function updateAsset(input: {
  assetId: string;
  userId: string;
  name?: string;
  description?: string;
}): Promise<Asset | null> {
  const { assetId, userId, name, description } = parse(updateInput, input);
  if (!isUuid(assetId)) return null;
  return getDb().transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    assertActive(row);
    if (name === undefined && description === undefined) return row;
    const [updated] = await tx
      .update(asset)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
      })
      .where(eq(asset.id, assetId))
      .returning();
    await logEvent(tx, row.projectId, userId, "asset.updated", {
      assetId,
      name: name !== undefined,
      description: description !== undefined,
    });
    return updated ?? null;
  });
}

/** Marks an asset removed (kept, never deleted). True when it is removed (also if it already was). */
export async function removeAsset(input: { assetId: string; userId: string }): Promise<boolean> {
  const { assetId, userId } = parse(assetRefInput, input);
  if (!isUuid(assetId)) return false;
  return getDb().transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return false;
    const { asset: row } = locked;
    if (row.status === "removed") return true;
    await tx.update(asset).set({ status: "removed" }).where(eq(asset.id, assetId));
    await logEvent(tx, row.projectId, userId, "asset.removed", {
      assetId,
      kind: row.kind,
      slug: row.slug,
    });
    return true;
  });
}

/**
 * Merges `mergeId` into `keepId` (same project and kind, both active): the merged asset becomes
 * removed and the current blocks' `assetRefs` point at the kept asset's slug instead.
 */
export async function mergeAssets(input: {
  keepId: string;
  mergeId: string;
  userId: string;
}): Promise<Asset | null> {
  const { keepId, mergeId, userId } = parse(mergeInput, input);
  if (!isUuid(keepId) || !isUuid(mergeId)) return null;
  if (keepId === mergeId) throw new AssetInputError("Pick two different assets to merge.");
  return getDb().transaction(async (tx) => {
    const [first] = await tx
      .select({ projectId: asset.projectId })
      .from(asset)
      .where(eq(asset.id, keepId))
      .limit(1);
    if (!first) return null;
    // Project first (as block replacement does), then both assets in a fixed order.
    if (!(await openProject(tx, first.projectId, userId, true))) return null;
    const rows = await tx
      .select()
      .from(asset)
      .where(inArray(asset.id, [keepId, mergeId]))
      .orderBy(asc(asset.id))
      .for("update");
    const keep = rows.find((r) => r.id === keepId);
    const merged = rows.find((r) => r.id === mergeId);
    if (!keep || !merged || merged.projectId !== keep.projectId) return null;
    if (merged.kind !== keep.kind) {
      throw new AssetInputError("Only assets of the same kind can be merged.");
    }
    if (keep.status !== "active" || merged.status !== "active") {
      throw new AssetInputError(REMOVED_MESSAGE);
    }
    await tx.update(asset).set({ status: "removed" }).where(eq(asset.id, mergeId));
    const blocksRewritten = await rewriteAssetRefs(
      {
        projectId: keep.projectId,
        from: `${merged.kind}:${merged.slug}`,
        to: `${keep.kind}:${keep.slug}`,
      },
      tx,
    );
    await logEvent(tx, keep.projectId, userId, "asset.merged", {
      keepId,
      mergeId,
      kind: keep.kind,
      keepSlug: keep.slug,
      mergeSlug: merged.slug,
      blocksRewritten,
    });
    return keep;
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Completing the stage                                                                        */
/* ------------------------------------------------------------------------------------------ */

/**
 * Moves the project from pre-production to production once every active asset is ready. True
 * when this call advanced it; false when the project is not the user's or already moved on.
 * Throws `AssetInputError` while assets are not ready.
 */
export async function completePreProduction(input: {
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const { projectId, userId } = parse(
    z.object({ projectId: z.string(), userId: userIdSchema }),
    input,
  );
  return getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned || owned.stage !== "pre_production") return false;
    const overview = summarise(await readiness(tx, projectId), owned.stage);
    if (overview.total === 0) {
      throw new AssetInputError("There are no assets yet. Wait for detection or add one.");
    }
    if (!overview.canComplete) {
      throw new AssetInputError(
        `Finish every asset first: ${overview.ready} of ${overview.total} are ready.`,
      );
    }
    const advanced = await advanceStage(
      { projectId, from: "pre_production", to: "production" },
      tx,
    );
    if (advanced) {
      await logEvent(tx, projectId, userId, "preproduction.completed", {
        assets: overview.total,
      });
    }
    return advanced;
  });
}
