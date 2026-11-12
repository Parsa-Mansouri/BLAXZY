/**
 * Shared internals of pre-production: row types, the views the screens get, and the queries that
 * load an asset's latest look and sheet (the inputs of `deriveAssetState`). Not exported from the
 * module index.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { SAMPLE_MODEL } from "@/server/damis";
import type { DbExecutor } from "@/server/db/client";
import {
  asset,
  assetLook,
  assetSheet,
  damiRun,
  generation,
  projectEvent,
  type AssetLookStatus,
  type LookAspectRatio,
  type LookReference,
  type LookSource,
  type LookSpec,
  type LookStatus,
  type SheetSpec,
} from "@/server/db/schema";
import { isSampleProvider } from "@/server/providers";
import { deriveAssetState, type AssetState } from "./stage";

export type AssetRow = typeof asset.$inferSelect;
export type LookRow = typeof assetLook.$inferSelect;
export type SheetRow = typeof assetSheet.$inferSelect;

/** What the screens show of a designer's spec (`LookSpec` without the dami's raw answer). */
export type LookSpecView = Omit<LookSpec, "output" | "referenceFileIds">;

export type LookView = {
  id: string;
  versionNumber: number;
  source: LookSource;
  status: AssetLookStatus;
  /** The image (or, for a voice, the recording). Null until produced. */
  fileId: string | null;
  userPrompt: string | null;
  guidedAnswers: Record<string, string> | null;
  /** The user's reference photos with their roles. */
  references: LookReference[];
  /** Answers to the designer's questions. */
  clarifyAnswers: Record<string, string> | null;
  /** The designer's spec, once its dami has run. */
  spec: LookSpecView | null;
  /** The image's ratio, when the designer chose one (else the project's orientation). */
  aspectRatio: LookAspectRatio | null;
  /** The look answers a rejected one (a fix or a re-roll) or an answered question. */
  parentId: string | null;
  /** A job has worked on it (a dami ran or a generation was requested). */
  started: boolean;
  /** User-readable reason when failed. */
  failure: string | null;
  /** Placeholder output (sample provider) or a prompt written in sample mode. */
  isSample: boolean;
  createdAt: Date;
  decidedAt: Date | null;
};

function specView(spec: LookSpec | null): LookSpecView | null {
  if (!spec) return null;
  const { output: _output, referenceFileIds: _files, ...rest } = spec;
  void _output;
  void _files;
  return rest;
}

/** What the screens show of a sheet maker's spec (`SheetSpec` without the dami's raw answer). */
export type SheetSpecView = Omit<SheetSpec, "output" | "referenceFileIds"> & {
  /** The requests the sheet maker refused as design changes (`DESIGN_CHANGE_REQUESTED:`). */
  designChanges: string[];
};

const DESIGN_CHANGE = "DESIGN_CHANGE_REQUESTED:";

function sheetSpecView(spec: SheetSpec | null): SheetSpecView | null {
  if (!spec) return null;
  const { output: _output, referenceFileIds: _files, ...rest } = spec;
  void _output;
  void _files;
  return {
    ...rest,
    designChanges: spec.warnings
      .filter((w) => w.trim().startsWith(DESIGN_CHANGE))
      .map((w) => w.trim().slice(DESIGN_CHANGE.length).trim()),
  };
}

export type SheetView = {
  id: string;
  versionNumber: number;
  lookId: string;
  status: LookStatus;
  /** A character sheet's image; a location pack's or prop sheet's contact sheet once locked. */
  fileId: string | null;
  /** The sheet maker's spec (frames, warnings, scale card ...), once it has run. */
  spec: SheetSpecView | null;
  /** The sheet answers a rejected one (a fix or a re-roll). */
  parentId: string | null;
  failure: string | null;
  isSample: boolean;
  createdAt: Date;
  decidedAt: Date | null;
};

/** Looks and sheets listed in an asset's detail, newest first. */
export const MAX_LISTED_VERSIONS = 20;

function sampleFlag(provider: string | null, model: string | null): boolean {
  return (provider !== null && isSampleProvider(provider)) || model === SAMPLE_MODEL;
}

export function toLookView(row: LookRow, provider: string | null, model: string | null): LookView {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    source: row.source,
    status: row.status,
    fileId: row.fileId,
    userPrompt: row.userPrompt,
    guidedAnswers: row.guidedAnswers,
    references: row.references,
    clarifyAnswers: row.clarifyAnswers,
    spec: specView(row.spec),
    aspectRatio: row.spec?.aspectRatio ?? null,
    parentId: row.parentId,
    started: row.prompt !== null || row.damiRunId !== null || row.generationId !== null,
    failure: row.failure,
    isSample: sampleFlag(provider, model),
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

export function toSheetView(
  row: SheetRow,
  provider: string | null,
  model: string | null,
): SheetView {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    lookId: row.lookId,
    status: row.status,
    fileId: row.fileId,
    spec: sheetSpecView(row.spec),
    parentId: row.parentId,
    failure: row.failure,
    isSample: sampleFlag(provider, model),
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

/** Newest looks of one asset, with what is needed for `isSample`. */
export async function listLookViews(
  db: DbExecutor,
  assetId: string,
  limit = MAX_LISTED_VERSIONS,
): Promise<LookView[]> {
  const rows = await db
    .select({ look: assetLook, provider: generation.provider, model: damiRun.model })
    .from(assetLook)
    .leftJoin(generation, eq(generation.id, assetLook.generationId))
    .leftJoin(damiRun, eq(damiRun.id, assetLook.damiRunId))
    .where(eq(assetLook.assetId, assetId))
    .orderBy(desc(assetLook.versionNumber))
    .limit(limit);
  return rows.map((r) => toLookView(r.look, r.provider, r.model));
}

export async function listSheetViews(
  db: DbExecutor,
  assetId: string,
  limit = MAX_LISTED_VERSIONS,
): Promise<SheetView[]> {
  const rows = await db
    .select({ sheet: assetSheet, provider: generation.provider, model: damiRun.model })
    .from(assetSheet)
    .leftJoin(generation, eq(generation.id, assetSheet.generationId))
    .leftJoin(damiRun, eq(damiRun.id, assetSheet.damiRunId))
    .where(eq(assetSheet.assetId, assetId))
    .orderBy(desc(assetSheet.versionNumber))
    .limit(limit);
  return rows.map((r) => toSheetView(r.sheet, r.provider, r.model));
}

export async function loadLookView(db: DbExecutor, lookId: string): Promise<LookView | null> {
  const [row] = await db
    .select({ look: assetLook, provider: generation.provider, model: damiRun.model })
    .from(assetLook)
    .leftJoin(generation, eq(generation.id, assetLook.generationId))
    .leftJoin(damiRun, eq(damiRun.id, assetLook.damiRunId))
    .where(eq(assetLook.id, lookId))
    .limit(1);
  return row ? toLookView(row.look, row.provider, row.model) : null;
}

export async function latestLook(db: DbExecutor, assetId: string): Promise<LookRow | null> {
  const [row] = await db
    .select()
    .from(assetLook)
    .where(eq(assetLook.assetId, assetId))
    .orderBy(desc(assetLook.versionNumber))
    .limit(1);
  return row ?? null;
}

export async function latestSheet(db: DbExecutor, assetId: string): Promise<SheetRow | null> {
  const [row] = await db
    .select()
    .from(assetSheet)
    .where(eq(assetSheet.assetId, assetId))
    .orderBy(desc(assetSheet.versionNumber))
    .limit(1);
  return row ?? null;
}

/** The asset's state from its latest look and sheet. */
export async function loadAssetState(
  db: DbExecutor,
  row: Pick<AssetRow, "id" | "kind">,
): Promise<{ state: AssetState; look: LookRow | null; sheet: SheetRow | null }> {
  const look = await latestLook(db, row.id);
  const sheet = await latestSheet(db, row.id);
  return { state: deriveAssetState(row.kind, look, sheet), look, sheet };
}

/** The latest look and sheet of each asset (one query each, `DISTINCT ON`). */
export async function latestByAsset(
  db: DbExecutor,
  assetIds: string[],
): Promise<{ looks: Map<string, LookRow>; sheets: Map<string, SheetRow> }> {
  if (assetIds.length === 0) return { looks: new Map(), sheets: new Map() };
  const looks = await db
    .selectDistinctOn([assetLook.assetId])
    .from(assetLook)
    .where(inArray(assetLook.assetId, assetIds))
    .orderBy(assetLook.assetId, desc(assetLook.versionNumber));
  const sheets = await db
    .selectDistinctOn([assetSheet.assetId])
    .from(assetSheet)
    .where(inArray(assetSheet.assetId, assetIds))
    .orderBy(assetSheet.assetId, desc(assetSheet.versionNumber));
  return {
    looks: new Map(looks.map((l) => [l.assetId, l])),
    sheets: new Map(sheets.map((s) => [s.assetId, s])),
  };
}

/** The newest look (or sheet) of each asset with the given status. */
export async function newestLookWithStatus(
  db: DbExecutor,
  assetIds: string[],
  status: AssetLookStatus,
): Promise<Map<string, LookRow>> {
  if (assetIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([assetLook.assetId])
    .from(assetLook)
    .where(and(inArray(assetLook.assetId, assetIds), eq(assetLook.status, status)))
    .orderBy(assetLook.assetId, desc(assetLook.versionNumber));
  return new Map(rows.map((l) => [l.assetId, l]));
}

export async function newestSheetWithStatus(
  db: DbExecutor,
  assetIds: string[],
  status: LookStatus,
): Promise<Map<string, SheetRow>> {
  if (assetIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([assetSheet.assetId])
    .from(assetSheet)
    .where(and(inArray(assetSheet.assetId, assetIds), eq(assetSheet.status, status)))
    .orderBy(assetSheet.assetId, desc(assetSheet.versionNumber));
  return new Map(rows.map((s) => [s.assetId, s]));
}

export async function logEvent(
  db: DbExecutor,
  projectId: string,
  userId: string | null,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(projectEvent).values({ projectId, userId, type, payload });
}
