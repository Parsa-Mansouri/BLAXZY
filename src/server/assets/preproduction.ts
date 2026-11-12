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
import { and, asc, eq, inArray, isNull, max, ne } from "drizzle-orm";
import { z } from "zod";
import { rewriteAssetRefs } from "@/server/blocks";
import {
  AI_DECIDES,
  buildFixRequests,
  cleanAssetName,
  DESIGNER_CATALOGS,
  designerFor,
  findReviewOption,
  fixRequestCodes,
  formatAssetRef,
  getReviewCatalog,
  MAX_ASSET_NAME,
  ReviewCatalogError,
  uniqueName,
  type FixSelection,
  type GuidedQuestion,
} from "@/server/damis";
import { getDb, type DbExecutor, type DbTx } from "@/server/db/client";
import {
  ASSET_KINDS,
  asset,
  assetLook,
  assetSheet,
  assetSheetView,
  project,
  review,
  WIZARD_STAGES,
  type AssetKind,
  type LookReference,
  type LookSpecField,
  type ReviewFixRequest,
  type WizardStage,
} from "@/server/db/schema";
import {
  assetLookFix,
  assetLookGenerate,
  assetSheetFix,
  assetSheetGenerate,
  assetSheetPlan,
  enqueue,
} from "@/server/jobs";
import { advanceStage, canOpenStage } from "@/server/projects";
import { FILE_PURPOSES, getOwnedFileInfo, type FilePurpose } from "@/server/storage";
import {
  checkReferences,
  locationsInFlight,
  questionsFor,
  referenceInputSchema,
  untouched,
  wakeWaitingLooks,
  type ReferenceInput,
} from "./designs";
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
import {
  dnaCardOf,
  enqueueAdvance,
  enqueueAssemble,
  latestViewRows,
  listPackViews,
  packKindOf,
  packLockGate,
  type DnaCard,
  type PackLockGate,
  type PackView,
  type PackViewRow,
} from "./packs";
import { AssetInputError, listAssets, parse, type Asset } from "./service";
import { deriveAssetState, pickNextAsset, type AssetStage } from "./stage";

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
  /** The guided questions still to ask (the designer's skip logic applied). */
  questions: GuidedQuestion[];
  /** A prop waiting for these locations' Heroes before it is designed (by name). */
  waitingFor: string[];
  /** Images sent back in a row since the last accepted one (for the "describe it" hint). */
  rejectedInARow: number;
  /** Locations and props: the views of the latest sheet (latest version of each), in order. */
  packViews: PackView[];
  /** Locations and props: whether the latest pack can be locked, and what is missing. */
  lockGate: PackLockGate | null;
  /** Locations and props: the accepted design's DNA card. */
  dnaCard: DnaCard | null;
};

export type PreProductionOverview = {
  /** Only kinds that have active assets, in the order of `ASSET_KINDS`. */
  kinds: { kind: AssetKind; total: number; ready: number }[];
  total: number;
  ready: number;
  /** Every active asset is ready and the project is in pre-production. */
  canComplete: boolean;
};

/** Longest prompt a user may write for a look (the designers' limit). */
export const MAX_LOOK_PROMPT_LENGTH = 4000;
/** Longest answer to one guided question (the designers' limit). */
export const MAX_GUIDED_ANSWER_LENGTH = 1000;
export const MAX_REVIEW_NOTE_LENGTH = 2000;
export const MAX_ASSET_NAME_LENGTH = MAX_ASSET_NAME;
export const MAX_ASSET_DESCRIPTION_LENGTH = 4000;
export const DEFAULT_CARD_PAGE_SIZE = 24;
export const MAX_CARD_PAGE_SIZE = 100;

const BUSY_MESSAGE = "This asset is still being worked on. Wait for it to finish, then try again.";
const REMOVED_MESSAGE = "This asset was removed from the project.";
const STAGE_MESSAGE = "Accept a script before starting pre-production.";
const ENQUEUE_FAILURE = "This step could not start. Try again in a moment.";

const uuid = z.uuid();
const isUuid = (value: string) => uuid.safeParse(value).success;
const userIdSchema = z.string().trim().min(1).max(128);

/* ------------------------------------------------------------------------------------------ */
/* Input schemas                                                                               */
/* ------------------------------------------------------------------------------------------ */

const assetRefInput = z.object({ assetId: z.string(), userId: userIdSchema });

const uploadInput = assetRefInput.extend({ fileId: z.string() });

const promptSchema = z
  .string({ error: "Describe the image you want." })
  .trim()
  .min(3, "Describe the image you want.")
  .max(MAX_LOOK_PROMPT_LENGTH, `Keep the description under ${MAX_LOOK_PROMPT_LENGTH} characters.`);

const promptInput = assetRefInput.extend({ prompt: promptSchema });

const answersSchema = z.record(
  z.string().max(64, "That is not one of the questions."),
  z
    .string({ error: "Answers must be text." })
    .max(
      MAX_GUIDED_ANSWER_LENGTH,
      `Keep each answer under ${MAX_GUIDED_ANSWER_LENGTH} characters.`,
    ),
  { error: "Answer the questions first." },
);

const guidedInput = assetRefInput.extend({ answers: answersSchema });

const referencesSchema = z.array(referenceInputSchema).max(20);

/**
 * A new design: any mix of the user's words, guided answers and reference photos. With none of
 * them it is "Design it for me" (the designer works from the script and the project).
 */
const designInput = assetRefInput.extend({
  prompt: promptSchema.optional(),
  answers: answersSchema.optional(),
  references: referencesSchema.optional(),
});

const noteSchema = z
  .string()
  .trim()
  .max(MAX_REVIEW_NOTE_LENGTH, `Keep the note under ${MAX_REVIEW_NOTE_LENGTH} characters.`)
  .optional();

const fixSelectionSchema = z.object({
  code: z.string().trim().min(1).max(40),
  value: z.string().trim().max(1000).optional(),
  customText: z.string().trim().max(MAX_REVIEW_NOTE_LENGTH).optional(),
  viewId: z.string().trim().max(60).optional(),
  /** A character sheet's detail frame (SP01, SP02). */
  slot: z
    .object({ slot: z.number().int().min(1).max(6), subject: z.string().trim().min(1).max(300) })
    .optional(),
});

const specEditSchema = z.object({
  field: z.string().trim().min(1).max(200),
  value: z
    .string()
    .trim()
    .min(1, "Write the new value, or leave the field as it is.")
    .max(MAX_GUIDED_ANSWER_LENGTH, `Keep each value under ${MAX_GUIDED_ANSWER_LENGTH} characters.`),
});

const lookReviewInput = z.object({
  lookId: z.string(),
  userId: userIdSchema,
  decision: z.enum(["accepted", "rejected"], { error: "Accept or reject the image." }),
  /** Rejected: the catalog options picked (with chips, text and the view they are about). */
  selections: z.array(fixSelectionSchema).max(40).optional(),
  note: noteSchema,
  /** Rejected: the next version's photos (a photo replaced or dropped); default: the same. */
  references: referencesSchema.optional(),
  /** Rejected: values the user wrote on the spec card. */
  specEdits: z.array(specEditSchema).max(40).optional(),
  /** Rejected: answers to the designer's non-blocking questions. */
  clarifyAnswers: answersSchema.optional(),
  /** Accepted: the critical inferred spec fields the user checked. */
  confirmedFields: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
});

const sheetReviewInput = z.object({
  sheetId: z.string(),
  userId: userIdSchema,
  decision: z.enum(["accepted", "rejected"], { error: "Accept or reject the sheet." }),
  /** Rejected: the catalog options picked (with chips, text and the frame they are about). */
  selections: z.array(fixSelectionSchema).max(40).optional(),
  note: noteSchema,
});

const viewReviewInput = z.object({
  viewRowId: z.string(),
  userId: userIdSchema,
  decision: z.enum(["accepted", "rejected"], { error: "Approve the view or ask for changes." }),
  selections: z.array(fixSelectionSchema).max(40).optional(),
  note: noteSchema,
  /** Accepted: the reviewer approved the parts the view proposes (`new_hypotheses`). */
  hypothesesApproved: z.boolean().optional(),
});

const nameSchema = z
  .string({ error: "Give the asset a name." })
  .trim()
  .min(1, "Give the asset a name.")
  .max(MAX_ASSET_NAME_LENGTH, `Keep the name under ${MAX_ASSET_NAME_LENGTH} characters.`)
  .transform(cleanAssetName)
  .pipe(z.string().min(1, "Use letters or digits in the name."));
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

/**
 * Enqueues the job that produces a pending look: a fix when it answers a rejected parent (the
 * handler reads the parent and its review either way; the job name is for the logs).
 */
async function enqueueLookJob(
  look: Pick<LookRow, "id" | "parentId">,
  mode: "generate" | "fix" = look.parentId ? "fix" : "generate",
): Promise<void> {
  const job = mode === "fix" ? assetLookFix : assetLookGenerate;
  try {
    await enqueue(job, { lookId: look.id });
  } catch (error) {
    console.error(`[assets] could not enqueue ${job.name} for ${look.id}:`, error);
    await markEnqueueFailed("look", look.id);
  }
}

/**
 * Enqueues the job that produces a pending sheet: a location pack or prop sheet is planned by its
 * sheet maker (`asset.sheet.plan`); a character sheet is generated, or fixed when it answers a
 * rejected one.
 */
async function enqueueSheetJob(
  sheet: Pick<SheetRow, "id" | "parentId">,
  kind: AssetKind,
): Promise<void> {
  const job = packKindOf(kind)
    ? assetSheetPlan
    : sheet.parentId
      ? assetSheetFix
      : assetSheetGenerate;
  try {
    await enqueue(job, { sheetId: sheet.id });
  } catch (error) {
    console.error(`[assets] could not enqueue ${job.name} for ${sheet.id}:`, error);
    await markEnqueueFailed("sheet", sheet.id);
  }
}

/**
 * Checks guided answers against the questions still asked for this asset (`questions`); returns
 * the trimmed, non-empty ones. A choice may be answered in the user's own words ("Not what you
 * have in mind?"), and any question with `ai_decides` ("I'm not sure"); only optional questions
 * may be left empty.
 */
export function validateGuidedAnswers(
  questions: readonly GuidedQuestion[],
  answers: Record<string, string>,
): Record<string, string> {
  if (questions.length === 0) {
    throw new AssetInputError("This asset has no questions. Describe it or add photos instead.");
  }
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const id of Object.keys(answers)) {
    if (!byId.has(id)) throw new AssetInputError("One answer does not match any question.");
  }
  const result: Record<string, string> = {};
  for (const question of questions) {
    const value = (answers[question.id] ?? "").trim();
    if (value.length === 0) {
      if (!question.optional) {
        throw new AssetInputError(`Answer “${question.label}”, or choose I’m not sure.`);
      }
      continue;
    }
    result[question.id] = value === AI_DECIDES ? AI_DECIDES : value;
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
    .where(
      and(
        eq(asset.projectId, projectId),
        eq(asset.status, "active"),
        // A skipped asset (ADP01) is not designed: it never blocks the stage.
        ne(asset.priority, "skipped"),
      ),
    );
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

export type NextAsset = { id: string; name: string; kind: AssetKind; stage: AssetStage };

/**
 * The next active asset of the project that waits for the user (see `pickNextAsset`), after
 * `afterAssetId` in the overview's order and wrapping around; null when no other asset waits (or
 * the project is not the user's). Call it after starting a job, so the current asset is already in
 * a working stage. Reads the project's active assets and their latest look and sheet: three
 * queries, bounded by the project's asset count (as the overview's `readiness`).
 */
export async function nextAssetNeedingInput(
  projectId: string,
  userId: string,
  afterAssetId: string,
): Promise<NextAsset | null> {
  const db = getDb();
  if (!(await openProject(db, projectId, userId))) return null;
  const active = await db
    .select({ id: asset.id, name: asset.name, kind: asset.kind, displayOrder: asset.displayOrder })
    .from(asset)
    .where(
      and(
        eq(asset.projectId, projectId),
        eq(asset.status, "active"),
        // A skipped asset (ADP01) is not designed: it never blocks the stage.
        ne(asset.priority, "skipped"),
      ),
    );
  const { looks, sheets } = await latestByAsset(
    db,
    active.map((a) => a.id),
  );
  const staged = active.map((a) => ({
    ...a,
    stage: deriveAssetState(a.kind, looks.get(a.id) ?? null, sheets.get(a.id) ?? null).stage,
  }));
  const next = pickNextAsset(staged, afterAssetId, ASSET_KINDS);
  return next ? { id: next.id, name: next.name, kind: next.kind, stage: next.stage } : null;
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
  const latest = looks[0];
  const waitingFor =
    latest && latest.status === "pending" && !latest.started
      ? await locationsInFlight(db, row.asset)
      : [];
  const accepted = looks.findIndex((l) => l.status === "accepted");
  const since = accepted === -1 ? looks : looks.slice(0, accepted);
  const pack = packKindOf(row.asset.kind);
  const sheet = sheets[0];
  const packViews = pack && sheet ? await listPackViews(db, sheet.id) : [];
  const acceptedLook = looks.find((l) => l.status === "accepted");
  let lockGate: PackLockGate | null = null;
  let dnaCard: DnaCard | null = null;
  if (pack && sheet) {
    const rows = await latestViewRows(db, sheet.id);
    const [sheetRow] = await db.select().from(assetSheet).where(eq(assetSheet.id, sheet.id));
    lockGate = packLockGate(pack, sheetRow?.spec ?? null, rows);
  }
  if (pack && acceptedLook) {
    const [lookRow] = await db.select().from(assetLook).where(eq(assetLook.id, acceptedLook.id));
    dnaCard = dnaCardOf(pack, lookRow?.spec ?? null);
  }
  return {
    asset: row.asset,
    stage: state.stage,
    looks,
    sheets,
    busy: state.busy,
    questions: questionsFor(row.asset, row.project.style),
    waitingFor,
    rejectedInARow: since.filter((l) => l.status === "rejected").length,
    packViews,
    lockGate,
    dnaCard,
  };
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
    case "needs_answer":
      throw new AssetInputError("Answer the designer’s question first.");
    default:
      break;
  }
  throw new AssetInputError("This asset already has an accepted image. Replace it to start over.");
}

/**
 * Uses an uploaded recording as a voice's look: a ready audio file, accepted at once (no sheet);
 * it replaces any previous recording. Image assets take photos as references of a design
 * (`startDesign`) instead: the designers read them, they never become the look directly.
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
    if (row.kind !== "voice") {
      throw new AssetInputError(
        "Photos are references for the design: add them with a role, then create the image.",
      );
    }
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
      decidedAt: new Date(),
    });
    await logEvent(tx, row.projectId, userId, "asset.look_accepted", {
      assetId: row.id,
      lookId: look.id,
      source: "uploaded",
    });
    return look;
  });
  if (!created) return null;
  return loadLookView(getDb(), created.id);
}

/**
 * Starts a design: a pending look with what the user gave, then the designer's job. A prop that
 * stands in a location still being designed waits for it (no job yet): the location's accepted
 * Hero wakes it (`wakeWaitingLooks`), so the prop can match it.
 */
async function startGeneratedLook(
  assetId: string,
  userId: string,
  values: {
    userPrompt?: string;
    answers?: Record<string, string>;
    references?: ReferenceInput[];
  },
): Promise<LookView | null> {
  if (!isUuid(assetId)) return null;
  const db = getDb();
  // Photos are checked before the transaction (each reads the file table).
  const [preview] = await db.select().from(asset).where(eq(asset.id, assetId)).limit(1);
  const references =
    preview && values.references ? await checkReferences(preview, userId, values.references) : [];
  const created = await db.transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { asset: row, project: owner } = locked;
    if (row.kind === "voice") {
      throw new AssetInputError("Voices are recorded, not generated. Upload a recording.");
    }
    const guidedAnswers = values.answers
      ? validateGuidedAnswers(questionsFor(row, owner.style), values.answers)
      : null;
    await assertCanStartLook(tx, row);
    const waitingFor = await locationsInFlight(tx, row);
    const look = await insertLook(tx, {
      assetId: row.id,
      projectId: row.projectId,
      source: "generated",
      status: "pending",
      userPrompt: values.userPrompt ?? null,
      guidedAnswers,
      references,
      createdBy: userId,
    });
    const source = guidedAnswers
      ? "guided"
      : values.userPrompt
        ? "prompt"
        : references.length > 0
          ? "references"
          : "auto";
    await logEvent(tx, row.projectId, userId, "asset.look_started", {
      assetId: row.id,
      lookId: look.id,
      source,
      references: references.length,
      ...(waitingFor.length > 0 ? { waitingFor } : {}),
    });
    return { look, waiting: waitingFor.length > 0 };
  });
  if (!created) return null;
  if (!created.waiting) await enqueueLookJob(created.look);
  return loadLookView(getDb(), created.look.id);
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
 * Generates a look from answers to the asset's guided questions (keyed by question id; a choice
 * may be answered in the user's own words, any question with `ai_decides`).
 */
export async function startLookFromGuided(input: {
  assetId: string;
  userId: string;
  answers: Record<string, string>;
}): Promise<LookView | null> {
  const { assetId, userId, answers } = parse(guidedInput, input);
  return startGeneratedLook(assetId, userId, { answers });
}

/**
 * Starts a design from any mix of the user's words, guided answers and reference photos (each
 * with a role). With none of them it is "Design it for me": the designer works from the script
 * and the project alone.
 */
export async function startDesign(input: {
  assetId: string;
  userId: string;
  prompt?: string;
  answers?: Record<string, string>;
  references?: ReferenceInput[];
}): Promise<LookView | null> {
  const { assetId, userId, prompt, answers, references } = parse(designInput, input);
  return startGeneratedLook(assetId, userId, {
    ...(prompt ? { userPrompt: prompt } : {}),
    ...(answers && Object.keys(answers).length > 0 ? { answers } : {}),
    ...(references ? { references } : {}),
  });
}

/**
 * Starts a prop that waits for its locations without waiting any longer (it is then designed
 * without their Heroes). Returns the stage, or null when the asset is not the user's.
 */
export async function startWithoutWaiting(input: {
  assetId: string;
  userId: string;
}): Promise<AssetStage | null> {
  const { assetId, userId } = parse(assetRefInput, input);
  if (!isUuid(assetId)) return null;
  const look = await getDb().transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { look: latest } = await loadAssetState(tx, locked.asset);
    if (!latest || !untouched(latest)) {
      throw new AssetInputError("This design has already started. Reload the page.");
    }
    await logEvent(tx, locked.asset.projectId, userId, "asset.look_wait_skipped", {
      assetId,
      lookId: latest.id,
    });
    return latest;
  });
  if (!look) return null;
  await enqueueLookJob(look);
  return "generating";
}

/* ------------------------------------------------------------------------------------------ */
/* Reviews                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const NEEDS_REASON = "Say what is wrong: pick a reason, write a note or change a field.";
const NOT_IN_REVIEW = "This is no longer waiting for review. Reload the page.";
const ISSUE_NOT_FOR_KIND = "One of the issues does not apply to this kind of asset.";
const CHECK_FIELDS =
  "Check the highlighted fields on the spec card first: confirm each one or change it.";

/** The code of a spec-card edit sent to the designer as a fix request. */
export const SPEC_EDIT_CODE = "SPEC_EDIT";

/**
 * The critical spec fields the designer filled in itself (inferred). The owner: they are reviewed
 * by the user before the design is locked, even when the user let the designer decide.
 */
export function fieldsToConfirm(spec: { fields: readonly LookSpecField[] } | null): string[] {
  return (spec?.fields ?? [])
    .filter((f) => f.critical && f.status === "inferred")
    .map((f) => f.field);
}

type LookReviewPlan = {
  fixRequests: ReviewFixRequest[];
  /** The re-roll option picked (no dami call), when it is the only thing asked. */
  regenerate: string | null;
};

/**
 * The fix requests for a rejection, from the designer's catalog (the Wizard hides Pro-only
 * options) and the spec card's edits. A re-roll option (`regenerate`) makes no request.
 */
function planLookReview(
  kind: AssetKind,
  selections: readonly FixSelection[],
  specEdits: readonly { field: string; value: string }[],
): LookReviewPlan {
  const designer = designerFor(kind);
  if (!designer) throw new AssetInputError(ISSUE_NOT_FOR_KIND);
  const catalog = getReviewCatalog(DESIGNER_CATALOGS[designer]);
  let regenerate: string | null = null;
  for (const selection of selections) {
    const option = findReviewOption(catalog, selection.code);
    if (!option || option.proOnly) throw new AssetInputError(ISSUE_NOT_FOR_KIND);
    if (option.kind === "regenerate") regenerate = option.code;
  }
  let fixRequests: ReviewFixRequest[];
  try {
    fixRequests = buildFixRequests(catalog, selections);
  } catch (error) {
    if (error instanceof ReviewCatalogError) {
      const code = selections.find((s) => error.message.includes(s.code))?.code;
      const label = code ? findReviewOption(catalog, code)?.label : undefined;
      throw new AssetInputError(
        label ? `Say what you want for “${label}”.` : "Say what you want for each reason.",
      );
    }
    throw error;
  }
  for (const edit of specEdits) {
    fixRequests.push({
      type: "preference",
      code: SPEC_EDIT_CODE,
      instruction: `Set the spec field "${edit.field}" to: ${edit.value}. The user confirmed it (status confirmed, source user): keep the rest of the spec, the DNA and the prompt consistent with it.`,
    });
  }
  return { fixRequests, regenerate };
}

function sameReferences(a: readonly LookReference[], b: readonly LookReference[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.fileId === b[i]?.fileId && r.role === b[i]?.role && r.note === b[i]?.note)
  );
}

/**
 * Accepts or rejects a look in review (the asset's latest), recording the review with the dami
 * run that wrote its prompt.
 *
 * Accepted: a location's or prop's critical inferred spec fields must be in `confirmedFields`;
 * any earlier accepted look and sheet are superseded and a sheet is started. A location that is
 * accepted wakes the props waiting for it.
 *
 * Rejected: the catalog picks become `fix_requests` (and `issue_codes`); spec-card edits, answers
 * to the designer's questions and changed photos go with them. A re-roll picked alone makes a new
 * version with the same prompt and a new seed (no dami call); anything else is a fix round
 * (`asset.look.fix`). An uploaded look (older projects) sends the asset back to needs_image.
 */
export async function submitLookReview(input: {
  lookId: string;
  userId: string;
  decision: "accepted" | "rejected";
  selections?: FixSelection[];
  note?: string;
  references?: ReferenceInput[];
  specEdits?: { field: string; value: string }[];
  clarifyAnswers?: Record<string, string>;
  confirmedFields?: string[];
}): Promise<AssetStage | null> {
  const parsed = parse(lookReviewInput, input);
  const { lookId, userId, decision } = parsed;
  const note = parsed.note ? parsed.note : null;
  const selections = parsed.selections ?? [];
  const specEdits = parsed.specEdits ?? [];
  const clarify = parsed.clarifyAnswers ?? {};
  if (!isUuid(lookId)) return null;
  const db = getDb();
  const [target] = await db
    .select({ asset })
    .from(assetLook)
    .innerJoin(asset, eq(asset.id, assetLook.assetId))
    .where(eq(assetLook.id, lookId))
    .limit(1);
  if (!target) return null;
  const newReferences =
    decision === "rejected" && parsed.references
      ? await checkReferences(target.asset, userId, parsed.references)
      : null;
  const outcome = await db.transaction(async (tx) => {
    const locked = await lockAsset(tx, target.asset.id, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    assertActive(row);
    const plan =
      decision === "rejected"
        ? planLookReview(row.kind, selections, specEdits)
        : { fixRequests: [], regenerate: null };
    const { look: latest } = await loadAssetState(tx, row);
    if (!latest || latest.id !== lookId || latest.status !== "in_review") {
      throw new AssetInputError(NOT_IN_REVIEW);
    }
    const referencesChanged =
      newReferences !== null && !sameReferences(newReferences, latest.references);
    const clarifyGiven = Object.keys(clarify).length > 0;
    if (
      decision === "rejected" &&
      plan.fixRequests.length === 0 &&
      !plan.regenerate &&
      !note &&
      !clarifyGiven &&
      !referencesChanged
    ) {
      throw new AssetInputError(NEEDS_REASON);
    }
    const confirmed = [...new Set(parsed.confirmedFields ?? [])];
    if (decision === "accepted") {
      const missing = fieldsToConfirm(latest.spec).filter((f) => !confirmed.includes(f));
      if (missing.length > 0) throw new AssetInputError(CHECK_FIELDS);
    }
    const now = new Date();
    const issueCodes = [
      ...fixRequestCodes(plan.fixRequests),
      ...(plan.regenerate ? [plan.regenerate] : []),
    ];
    await tx.insert(review).values({
      projectId: row.projectId,
      userId,
      subjectType: "asset_look",
      subjectId: lookId,
      decision,
      issueCodes: decision === "rejected" ? issueCodes : [],
      fixRequests: decision === "rejected" ? plan.fixRequests : [],
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
        ...(referencesChanged ? { referencesChanged: true } : {}),
        ...(specEdits.length > 0 ? { specEdits: specEdits.map((e) => e.field) } : {}),
      });
      if (latest.source === "uploaded") return { stage: "needs_image" as const, job: null };
      const reroll =
        plan.regenerate !== null &&
        plan.fixRequests.length === 0 &&
        !note &&
        !clarifyGiven &&
        !referencesChanged &&
        latest.prompt !== null;
      const next = await insertLook(tx, {
        assetId: row.id,
        projectId: row.projectId,
        parentId: lookId,
        source: "generated",
        status: "pending",
        userPrompt: latest.userPrompt,
        guidedAnswers: latest.guidedAnswers,
        references: newReferences ?? latest.references,
        clarifyAnswers:
          clarifyGiven || latest.clarifyAnswers
            ? { ...(latest.clarifyAnswers ?? {}), ...clarify }
            : null,
        // A re-roll keeps the prompt, the spec and the dami run: only the seed changes.
        ...(reroll
          ? { prompt: latest.prompt, spec: latest.spec, damiRunId: latest.damiRunId }
          : {}),
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
      ...(confirmed.length > 0 ? { confirmedFields: confirmed } : {}),
    });
    return { stage: "building_sheet" as const, job: { kind: "sheet" as const, row: sheet } };
  });
  if (!outcome) return null;
  if (outcome.job?.kind === "look") await enqueueLookJob(outcome.job.row);
  if (outcome.job?.kind === "sheet") await enqueueSheetJob(outcome.job.row, target.asset.kind);
  if (decision === "accepted" && designerFor(target.asset.kind) === "location") {
    await wakeWaitingLooks(target.asset.projectId);
  }
  return outcome.stage;
}

/**
 * Answers the designer's questions on a look that waits for them (`needs_input`, the prop
 * designer's blocking question). The look is superseded and a new version is designed with the
 * answers (`clarify_answers`). An answer of `ai_decides` takes the question's default; blocking
 * questions must be answered.
 */
export async function answerLookQuestion(input: {
  lookId: string;
  userId: string;
  answers: Record<string, string>;
}): Promise<AssetStage | null> {
  const { lookId, userId, answers } = parse(
    z.object({ lookId: z.string(), userId: userIdSchema, answers: answersSchema }),
    input,
  );
  if (!isUuid(lookId)) return null;
  const next = await getDb().transaction(async (tx) => {
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
    if (!latest || latest.id !== lookId || latest.status !== "needs_input") {
      throw new AssetInputError("There is no question waiting here. Reload the page.");
    }
    const questions = latest.spec?.questions ?? [];
    const byId = new Map(questions.map((q) => [q.id, q]));
    const clarify: Record<string, string> = { ...(latest.clarifyAnswers ?? {}) };
    for (const [id, raw] of Object.entries(answers)) {
      const question = byId.get(id);
      if (!question) throw new AssetInputError("One answer does not match any question.");
      const value = raw.trim();
      if (value) clarify[id] = value === AI_DECIDES ? question.default : value;
    }
    for (const q of questions) {
      if (q.blocking && !clarify[q.id]) {
        throw new AssetInputError(`Answer “${q.question}”, or choose I’m not sure.`);
      }
    }
    const now = new Date();
    await tx
      .update(assetLook)
      .set({ status: "superseded", decidedAt: now })
      .where(eq(assetLook.id, lookId));
    const look = await insertLook(tx, {
      assetId: row.id,
      projectId: row.projectId,
      parentId: lookId,
      source: "generated",
      status: "pending",
      userPrompt: latest.userPrompt,
      guidedAnswers: latest.guidedAnswers,
      references: latest.references,
      clarifyAnswers: clarify,
      createdBy: userId,
    });
    await logEvent(tx, row.projectId, userId, "asset.look_answered", {
      assetId: row.id,
      lookId,
      nextLookId: look.id,
      questions: Object.keys(answers),
    });
    return look;
  });
  if (!next) return null;
  await enqueueLookJob(next, "generate");
  return "generating";
}

/** The sheet maker's catalog of an asset kind. */
function sheetCatalogFor(kind: AssetKind) {
  const pack = packKindOf(kind);
  return getReviewCatalog(
    pack === "location"
      ? "sheet-generator-location"
      : pack === "prop"
        ? "sheet-generator-prop"
        : "sheet-generator-character",
  );
}

type SheetReviewPlan = {
  fixRequests: ReviewFixRequest[];
  /** The re-roll option picked (no dami call). */
  regenerate: string | null;
  /** The design-change option picked (back to the designer), with the user's words. */
  route: { code: string; text: string | null } | null;
};

/** The fix requests for a sheet's (or a view's) rejection, from the sheet maker's catalog. */
function planSheetReview(kind: AssetKind, selections: readonly FixSelection[]): SheetReviewPlan {
  const catalog = sheetCatalogFor(kind);
  let regenerate: string | null = null;
  let route: SheetReviewPlan["route"] = null;
  for (const selection of selections) {
    const option = findReviewOption(catalog, selection.code);
    if (!option || option.proOnly) throw new AssetInputError(ISSUE_NOT_FOR_KIND);
    if (option.kind === "regenerate") regenerate = option.code;
    if (option.kind === "route") {
      route = { code: option.code, text: selection.customText?.trim() || null };
    }
  }
  try {
    return { fixRequests: buildFixRequests(catalog, selections), regenerate, route };
  } catch (error) {
    if (error instanceof ReviewCatalogError) {
      const code = selections.find((s) => error.message.includes(s.code))?.code;
      const label = code ? findReviewOption(catalog, code)?.label : undefined;
      throw new AssetInputError(
        label ? `Say what you want for “${label}”.` : "Say what you want for each reason.",
      );
    }
    throw error;
  }
}

/**
 * Sends an asset back to its designer from the sheet step (the owner's SX01, LSX01, ASX01, or a
 * `DESIGN_CHANGE_REQUESTED:` warning): the sheet is rejected, the accepted design is rejected with
 * the request as a fix request, and the design's next version is started (a designer fix round).
 * Once the new design is accepted, a new sheet is built automatically. Returns the new look.
 */
async function sendBackToDesigner(
  tx: DbTx,
  input: {
    row: AssetRow;
    look: LookRow;
    sheet: SheetRow;
    userId: string;
    code: string;
    text: string | null;
    note: string | null;
    viewLabel?: string;
  },
): Promise<LookRow> {
  const { row, look, sheet, userId, code } = input;
  const words = input.text ?? input.note;
  if (!words) {
    throw new AssetInputError("Say what should change in the design.");
  }
  const where = input.viewLabel ? ` (seen in the ${input.viewLabel} view)` : "";
  const request: ReviewFixRequest = {
    type: "preference",
    code,
    instruction: `At the sheet step the user asked for a design change${where}: ${words}. Apply it to the design and keep everything else.`,
    customText: words,
  };
  const now = new Date();
  await tx.insert(review).values({
    projectId: row.projectId,
    userId,
    subjectType: "asset_sheet",
    subjectId: sheet.id,
    decision: "rejected",
    issueCodes: [code],
    fixRequests: [request],
    note: input.note,
    damiRunId: sheet.damiRunId,
  });
  await tx
    .update(assetSheet)
    .set({ status: "rejected", decidedAt: now })
    .where(eq(assetSheet.id, sheet.id));
  await tx.insert(review).values({
    projectId: row.projectId,
    userId,
    subjectType: "asset_look",
    subjectId: look.id,
    decision: "rejected",
    issueCodes: [code],
    fixRequests: [request],
    note: input.note,
    damiRunId: look.damiRunId,
  });
  await tx
    .update(assetLook)
    .set({ status: "rejected", decidedAt: now })
    .where(eq(assetLook.id, look.id));
  const next = await insertLook(tx, {
    assetId: row.id,
    projectId: row.projectId,
    parentId: look.id,
    source: "generated",
    status: "pending",
    userPrompt: look.userPrompt,
    guidedAnswers: look.guidedAnswers,
    references: look.references,
    clarifyAnswers: look.clarifyAnswers,
    createdBy: userId,
  });
  await logEvent(tx, row.projectId, userId, "asset.sent_back_to_designer", {
    assetId: row.id,
    sheetId: sheet.id,
    lookId: look.id,
    nextLookId: next.id,
    code,
  });
  return next;
}

/**
 * Accepts or rejects a character sheet in review (the asset's latest, built from its accepted
 * look); a ready asset's accepted sheet can also be sent back (the Review All pass).
 *
 * Accepted: the asset is ready. Rejected: the catalog picks become `fix_requests` (and
 * `issue_codes`). SR01 alone re-rolls the image (same prompt, new seed, no dami call). SX01 sends
 * the asset back to the Character Generator with the user's words (the sheet is rebuilt once the
 * new board is accepted). Anything else is a fix round of the sheet maker (`asset.sheet.fix`).
 * Location packs and prop sheets are reviewed view by view (`submitSheetViewReview`, `lockSheet`);
 * only the design route applies to them here.
 */
export async function submitSheetReview(input: {
  sheetId: string;
  userId: string;
  decision: "accepted" | "rejected";
  selections?: FixSelection[];
  note?: string;
}): Promise<AssetStage | null> {
  const parsed = parse(sheetReviewInput, input);
  const { sheetId, userId, decision } = parsed;
  const selections = parsed.selections ?? [];
  const note = parsed.note ? parsed.note : null;
  if (!isUuid(sheetId)) return null;
  if (decision === "rejected" && selections.length === 0 && !note) {
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
    const plan =
      decision === "rejected"
        ? planSheetReview(row.kind, selections)
        : { fixRequests: [], regenerate: null, route: null };
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
    const pack = packKindOf(row.kind);
    if (pack && !plan.route) {
      throw new AssetInputError(
        decision === "accepted"
          ? "Approve the views one by one, then lock the sheet."
          : "Ask for changes on the view itself, or change the design.",
      );
    }
    if (plan.route) {
      const next = await sendBackToDesigner(tx, {
        row,
        look,
        sheet: latest,
        userId,
        code: plan.route.code,
        text: plan.route.text,
        note,
      });
      return { stage: "generating" as const, job: { kind: "look" as const, row: next } };
    }
    const now = new Date();
    const issueCodes = [
      ...fixRequestCodes(plan.fixRequests),
      ...(plan.regenerate ? [plan.regenerate] : []),
    ];
    await tx.insert(review).values({
      projectId: row.projectId,
      userId,
      subjectType: "asset_sheet",
      subjectId: sheetId,
      decision,
      issueCodes: decision === "rejected" ? issueCodes : [],
      fixRequests: decision === "rejected" ? plan.fixRequests : [],
      note,
      damiRunId: latest.damiRunId,
    });
    if (decision === "rejected") {
      if (plan.fixRequests.length === 0 && !plan.regenerate && !note) {
        throw new AssetInputError(NEEDS_REASON);
      }
      await tx
        .update(assetSheet)
        .set({ status: "rejected", decidedAt: now })
        .where(eq(assetSheet.id, sheetId));
      const reroll =
        plan.regenerate !== null &&
        plan.fixRequests.length === 0 &&
        !note &&
        latest.prompt !== null;
      const next = await insertSheet(tx, {
        assetId: row.id,
        projectId: row.projectId,
        lookId: latest.lookId,
        parentId: sheetId,
        status: "pending",
        // A re-roll keeps the prompt, the spec and the dami run: only the seed changes.
        ...(reroll
          ? { prompt: latest.prompt, spec: latest.spec, damiRunId: latest.damiRunId }
          : {}),
      });
      await logEvent(tx, row.projectId, userId, "asset.sheet_rejected", {
        assetId: row.id,
        sheetId,
        nextSheetId: next.id,
        issueCodes,
      });
      return { stage: "building_sheet" as const, job: { kind: "sheet" as const, row: next } };
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
    return { stage: "ready" as const, job: null };
  });
  if (!outcome) return null;
  if (outcome.job?.kind === "sheet") await enqueueSheetJob(outcome.job.row, "character");
  if (outcome.job?.kind === "look") await enqueueLookJob(outcome.job.row, "fix");
  return outcome.stage;
}

/** The view, its sheet and its asset, the asset locked, when the user owns it. */
async function lockView(
  tx: DbTx,
  viewRowId: string,
  userId: string,
): Promise<{ view: PackViewRow; asset: AssetRow; look: LookRow; sheet: SheetRow } | null> {
  if (!isUuid(viewRowId)) return null;
  const [target] = await tx
    .select({ assetId: assetSheetView.assetId })
    .from(assetSheetView)
    .where(eq(assetSheetView.id, viewRowId))
    .limit(1);
  if (!target) return null;
  const locked = await lockAsset(tx, target.assetId, userId);
  if (!locked) return null;
  const { asset: row } = locked;
  assertActive(row);
  const { look, sheet } = await loadAssetState(tx, row);
  const views = sheet ? await latestViewRows(tx, sheet.id) : [];
  const view = views.find((v) => v.id === viewRowId);
  if (!look || !sheet || !view || look.status !== "accepted" || sheet.lookId !== look.id) {
    throw new AssetInputError(NOT_IN_REVIEW);
  }
  return { view, asset: row, look, sheet };
}

async function insertViewVersion(
  tx: DbTx,
  parent: PackViewRow,
  values: Partial<typeof assetSheetView.$inferInsert>,
): Promise<PackViewRow> {
  const [last] = await tx
    .select({ n: max(assetSheetView.versionNumber) })
    .from(assetSheetView)
    .where(
      and(eq(assetSheetView.sheetId, parent.sheetId), eq(assetSheetView.viewId, parent.viewId)),
    );
  const [row] = await tx
    .insert(assetSheetView)
    .values({
      sheetId: parent.sheetId,
      assetId: parent.assetId,
      projectId: parent.projectId,
      viewId: parent.viewId,
      versionNumber: (last?.n ?? 0) + 1,
      parentId: parent.id,
      label: parent.label,
      position: parent.position,
      status: "planned",
      purpose: parent.purpose,
      prompt: null,
      aspectRatio: parent.aspectRatio,
      referenceOrder: parent.referenceOrder,
      dependsOn: parent.dependsOn,
      mustShow: parent.mustShow,
      mustNotShow: parent.mustNotShow,
      reviewFocus: parent.reviewFocus,
      newHypotheses: parent.newHypotheses,
      editMode: "full",
      ...values,
    })
    .returning();
  if (!row) throw new Error("asset_sheet_view insert returned no row");
  return row;
}

const HYPOTHESES_FIRST =
  "Approve the parts this view proposes first, or send them back as a design change.";

/**
 * Approves a view of a location pack or prop sheet, or asks for changes.
 *
 * Accepted: the view's proposed parts (`new_hypotheses`) must be approved with it; the views that
 * waited for it are requested. Rejected: the catalog picks become `fix_requests`. A re-roll alone
 * (LSR01, ASR01) makes a new version with the same prompt and a new seed; a design change (LSX01,
 * ASX01) sends the asset back to its designer; anything else is a fix round that re-writes only
 * this view (`asset.sheet.plan` with the new version).
 */
export async function submitSheetViewReview(input: {
  viewRowId: string;
  userId: string;
  decision: "accepted" | "rejected";
  selections?: FixSelection[];
  note?: string;
  hypothesesApproved?: boolean;
}): Promise<AssetStage | null> {
  const parsed = parse(viewReviewInput, input);
  const { viewRowId, userId, decision } = parsed;
  const note = parsed.note ? parsed.note : null;
  const selections = parsed.selections ?? [];
  if (decision === "rejected" && selections.length === 0 && !note) {
    throw new AssetInputError(NEEDS_REASON);
  }
  const outcome = await getDb().transaction(async (tx) => {
    const found = await lockView(tx, viewRowId, userId);
    if (!found) return null;
    const { view, asset: row, look, sheet } = found;
    if (sheet.status !== "in_review" || view.status !== "in_review") {
      throw new AssetInputError(NOT_IN_REVIEW);
    }
    const now = new Date();
    if (decision === "accepted") {
      if (view.newHypotheses.length > 0 && !parsed.hypothesesApproved) {
        throw new AssetInputError(HYPOTHESES_FIRST);
      }
      await tx.insert(review).values({
        projectId: row.projectId,
        userId,
        subjectType: "asset_sheet_view",
        subjectId: view.id,
        decision,
        note,
        damiRunId: view.damiRunId,
      });
      await tx
        .update(assetSheetView)
        .set({ status: "accepted", decidedAt: now })
        .where(eq(assetSheetView.id, view.id));
      await logEvent(tx, row.projectId, userId, "asset.sheet_view_accepted", {
        assetId: row.id,
        sheetId: sheet.id,
        viewRowId: view.id,
        viewId: view.viewId,
      });
      return { stage: "sheet_review" as const, job: { kind: "advance" as const, id: sheet.id } };
    }
    const plan = planSheetReview(
      row.kind,
      selections.map((s) => ({ ...s, viewId: view.viewId })),
    );
    if (plan.route) {
      const next = await sendBackToDesigner(tx, {
        row,
        look,
        sheet,
        userId,
        code: plan.route.code,
        text: plan.route.text,
        note,
        viewLabel: view.label,
      });
      return { stage: "generating" as const, job: { kind: "look" as const, row: next } };
    }
    const issueCodes = [
      ...fixRequestCodes(plan.fixRequests),
      ...(plan.regenerate ? [plan.regenerate] : []),
    ];
    await tx.insert(review).values({
      projectId: row.projectId,
      userId,
      subjectType: "asset_sheet_view",
      subjectId: view.id,
      decision,
      issueCodes,
      fixRequests: plan.fixRequests,
      note,
      damiRunId: view.damiRunId,
    });
    await tx
      .update(assetSheetView)
      .set({ status: "rejected", decidedAt: now })
      .where(eq(assetSheetView.id, view.id));
    const reroll = plan.regenerate !== null && plan.fixRequests.length === 0 && !note;
    const next = await insertViewVersion(
      tx,
      view,
      reroll
        ? { prompt: view.prompt, editMode: view.editMode, warnings: [], damiRunId: view.damiRunId }
        : {},
    );
    await logEvent(tx, row.projectId, userId, "asset.sheet_view_rejected", {
      assetId: row.id,
      sheetId: sheet.id,
      viewRowId: view.id,
      nextViewRowId: next.id,
      issueCodes,
    });
    return {
      stage: "sheet_review" as const,
      job: reroll
        ? { kind: "advance" as const, id: sheet.id }
        : { kind: "fix" as const, id: sheet.id, viewRowId: next.id },
    };
  });
  if (!outcome) return null;
  const job = outcome.job;
  if (job.kind === "advance") await enqueueAdvance(job.id);
  if (job.kind === "look") await enqueueLookJob(job.row, "fix");
  if (job.kind === "fix") {
    try {
      await enqueue(assetSheetPlan, { sheetId: job.id, viewRowId: job.viewRowId });
    } catch (error) {
      console.error(`[assets] could not enqueue the fix of view ${job.viewRowId}:`, error);
      await getDb()
        .update(assetSheetView)
        .set({ status: "failed", failure: ENQUEUE_FAILURE })
        .where(and(eq(assetSheetView.id, job.viewRowId), eq(assetSheetView.status, "planned")));
    }
  }
  return outcome.stage;
}

/** Runs a failed view (its latest version) again: back to planned, then the pack advances. */
export async function retrySheetView(input: {
  viewRowId: string;
  userId: string;
}): Promise<AssetStage | null> {
  const { viewRowId, userId } = parse(
    z.object({ viewRowId: z.string(), userId: userIdSchema }),
    input,
  );
  const outcome = await getDb().transaction(async (tx) => {
    const found = await lockView(tx, viewRowId, userId);
    if (!found) return null;
    const { view, asset: row, sheet } = found;
    if (sheet.status !== "in_review" || view.status !== "failed") {
      throw new AssetInputError("Only a view that could not be made can be tried again.");
    }
    // A fix round that failed before its prompt was written runs the sheet maker again.
    const needsPrompt = view.prompt === null;
    await tx
      .update(assetSheetView)
      .set({ status: "planned", failure: null, generationId: null })
      .where(eq(assetSheetView.id, view.id));
    await logEvent(tx, row.projectId, userId, "asset.sheet_view_retried", {
      assetId: row.id,
      sheetId: sheet.id,
      viewRowId: view.id,
    });
    return { sheetId: sheet.id, needsPrompt };
  });
  if (!outcome) return null;
  if (outcome.needsPrompt) {
    await enqueue(assetSheetPlan, { sheetId: outcome.sheetId, viewRowId });
  } else {
    await enqueueAdvance(outcome.sheetId);
  }
  return "sheet_review";
}

/**
 * Locks a location pack or prop sheet once its lock rules hold (`packLockGate`): the sheet is
 * accepted (the asset is ready), views not approved by then are set aside (superseded), and the
 * contact sheet is assembled for people.
 */
export async function lockSheet(input: {
  sheetId: string;
  userId: string;
}): Promise<AssetStage | null> {
  const { sheetId, userId } = parse(z.object({ sheetId: z.string(), userId: userIdSchema }), input);
  if (!isUuid(sheetId)) return null;
  const locked = await getDb().transaction(async (tx) => {
    const [target] = await tx
      .select({ assetId: assetSheet.assetId })
      .from(assetSheet)
      .where(eq(assetSheet.id, sheetId))
      .limit(1);
    if (!target) return null;
    const found = await lockAsset(tx, target.assetId, userId);
    if (!found) return null;
    const { asset: row } = found;
    assertActive(row);
    const pack = packKindOf(row.kind);
    const { look, sheet } = await loadAssetState(tx, row);
    if (
      !pack ||
      !sheet ||
      sheet.id !== sheetId ||
      sheet.status !== "in_review" ||
      look?.id !== sheet.lookId ||
      look.status !== "accepted"
    ) {
      throw new AssetInputError(NOT_IN_REVIEW);
    }
    const views = await latestViewRows(tx, sheetId);
    const gate = packLockGate(pack, sheet.spec, views);
    if (!gate.canLock) {
      throw new AssetInputError(`Approve these first: ${gate.missing.join(", ")}.`);
    }
    const now = new Date();
    const setAside = views.filter((v) => v.status !== "accepted").map((v) => v.id);
    if (setAside.length > 0) {
      await tx
        .update(assetSheetView)
        .set({ status: "superseded" })
        .where(inArray(assetSheetView.id, setAside));
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
    await tx.insert(review).values({
      projectId: row.projectId,
      userId,
      subjectType: "asset_sheet",
      subjectId: sheetId,
      decision: "accepted",
      damiRunId: sheet.damiRunId,
    });
    await logEvent(tx, row.projectId, userId, "asset.sheet_accepted", {
      assetId: row.id,
      sheetId,
      lookId: sheet.lookId,
      views: views.filter((v) => v.status === "accepted").map((v) => v.viewId),
    });
    return true;
  });
  if (!locked) return null;
  await enqueueAssemble(sheetId);
  return "ready";
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
    return updated ? { row: updated, kind: row.kind } : null;
  });
  if (!sheet) return null;
  await enqueueSheetJob(sheet.row, sheet.kind);
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

/** The names of the project's assets of one kind (removed ones too: a name stays taken). */
async function takenNames(
  tx: DbTx,
  projectId: string,
  kind: AssetKind,
  exceptId?: string,
): Promise<string[]> {
  const rows = await tx
    .select({ name: asset.name })
    .from(asset)
    .where(
      and(
        eq(asset.projectId, projectId),
        eq(asset.kind, kind),
        exceptId ? ne(asset.id, exceptId) : undefined,
      ),
    );
  return rows.map((r) => r.name);
}

/**
 * Adds an asset by hand (origin manual; detection never changes or removes it). The name is
 * cleaned and made unique in its kind: a second "Mara" becomes "Mara (2)".
 */
export async function addAsset(input: {
  projectId: string;
  userId: string;
  kind: AssetKind;
  name: string;
  description?: string;
}): Promise<Asset | null> {
  const { projectId, userId, kind, name: given, description } = parse(addInput, input);
  return getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned) return null;
    const name = uniqueName(given, await takenNames(tx, projectId, kind));
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
        description: description ? description : null,
        status: "active",
        origin: "manual",
        displayOrder: (last?.order ?? -1) + 1,
      })
      .returning();
    if (!row) throw new Error("asset insert returned no row");
    await logEvent(tx, projectId, userId, "asset.added", { assetId: row.id, kind, name });
    return row;
  });
}

/**
 * Renames an asset or changes its description. The name is the asset's id, so a rename makes it
 * unique in its kind ("Mara (2)" when "Mara" is taken) and rewrites every current block that
 * refers to it (`rewriteAssetRefs`).
 */
export async function updateAsset(input: {
  assetId: string;
  userId: string;
  name?: string;
  description?: string;
}): Promise<Asset | null> {
  const { assetId, userId, name: given, description } = parse(updateInput, input);
  if (!isUuid(assetId)) return null;
  return getDb().transaction(async (tx) => {
    // Project first (as block rewrites do), then the asset.
    const [first] = await tx
      .select({ projectId: asset.projectId })
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1);
    if (!first) return null;
    if (!(await openProject(tx, first.projectId, userId, true))) return null;
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    assertActive(row);
    const name =
      given === undefined || given === row.name
        ? undefined
        : uniqueName(given, await takenNames(tx, row.projectId, row.kind, row.id));
    if (name === undefined && description === undefined) return row;
    const [updated] = await tx
      .update(asset)
      .set({
        // A rename keeps the old name as an alias (the owner's BO01), so re-detection still matches.
        ...(name !== undefined
          ? {
              name,
              details: {
                ...row.details,
                aliases: [...new Set([...(row.details?.aliases ?? []), row.name])],
              },
            }
          : {}),
        ...(description !== undefined ? { description: description || null } : {}),
      })
      .where(eq(asset.id, assetId))
      .returning();
    const blocksRewritten =
      name !== undefined
        ? await rewriteAssetRefs(
            {
              projectId: row.projectId,
              from: formatAssetRef(row.kind, row.name),
              to: formatAssetRef(row.kind, name),
            },
            tx,
          )
        : 0;
    await logEvent(tx, row.projectId, userId, "asset.updated", {
      assetId,
      name: name !== undefined,
      description: description !== undefined,
      ...(name !== undefined ? { from: row.name, to: name, blocksRewritten } : {}),
    });
    return updated ?? null;
  });
}

/**
 * Includes a skipped asset again (undoes ADP01): its priority goes back to what the detector
 * said (required when unknown). Returns the asset, or null when it is not the user's.
 */
export async function includeSkippedAsset(input: {
  assetId: string;
  userId: string;
}): Promise<Asset | null> {
  const { assetId, userId } = parse(assetRefInput, input);
  if (!isUuid(assetId)) return null;
  return getDb().transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    assertActive(row);
    if (row.priority !== "skipped") return row;
    const priority = row.details?.detectedPriority ?? "required";
    const [updated] = await tx
      .update(asset)
      .set({ priority })
      .where(eq(asset.id, assetId))
      .returning();
    await logEvent(tx, row.projectId, userId, "asset.included", { assetId, priority });
    return updated ?? null;
  });
}

/** Marks an asset removed (kept, never deleted). True when it is removed (also if it already was). */
export async function removeAsset(input: { assetId: string; userId: string }): Promise<boolean> {
  const { assetId, userId } = parse(assetRefInput, input);
  if (!isUuid(assetId)) return false;
  const removed = await getDb().transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    if (row.status === "removed") return { row, changed: false };
    await tx.update(asset).set({ status: "removed" }).where(eq(asset.id, assetId));
    await logEvent(tx, row.projectId, userId, "asset.removed", {
      assetId,
      kind: row.kind,
      name: row.name,
    });
    return { row, changed: true };
  });
  if (!removed) return false;
  // Props waiting for a removed location go ahead without it.
  if (removed.changed && removed.row.kind === "location") {
    await wakeWaitingLooks(removed.row.projectId);
  }
  return true;
}

/**
 * Merges `mergeId` into `keepId` (same project and kind, both active): the merged asset becomes
 * removed and the current blocks' refs and tags point at the kept asset instead.
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
        from: formatAssetRef(merged.kind, merged.name),
        to: formatAssetRef(keep.kind, keep.name),
      },
      tx,
    );
    await logEvent(tx, keep.projectId, userId, "asset.merged", {
      keepId,
      mergeId,
      kind: keep.kind,
      keepName: keep.name,
      mergeName: merged.name,
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
