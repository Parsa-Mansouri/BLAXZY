/** What the pre-production screens read: the overview, the asset cards and an asset's detail. */
import { and, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { designerFor, type GuidedQuestion } from "@/server/damis";
import { type DbExecutor, getDb } from "@/server/db/client";
import {
  asset,
  ASSET_KINDS,
  type AssetKind,
  assetLook,
  assetSheet,
  project,
  projectEvent,
} from "@/server/db/schema";
import { locationsInFlight, questionsFor } from "../designs";
import {
  type AssetRow,
  latestByAsset,
  listLookViews,
  listSheetViews,
  type LookView,
  newestLookWithStatus,
  newestSheetWithStatus,
  type SheetView,
} from "../looks";
import {
  type DnaCard,
  dnaCardOf,
  latestViewRows,
  listPackViews,
  packKindOf,
  packLockGate,
  type PackLockGate,
  type PackView,
} from "../packs";
import { type Asset, listAssetPage, parse } from "../service";
import { type AssetStage, deriveAssetState, pickNextAsset } from "../stage";
import { assertPreProductionOpen, isUuid, openProject } from "./access";
import { cardsInput } from "./inputs";

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
  /**
   * The latest look waits to be designed (a prop that waited for its locations, no job has
   * touched it yet): offer "start without waiting" (`startWithoutWaiting`), also when `waitingFor`
   * is already empty (its locations settled but the look was never started).
   */
  canStartWithoutWaiting: boolean;
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

/** One active asset with its pre-production stage (what the overview and the navigator read). */
export type ReadinessRow = {
  id: string;
  name: string;
  kind: AssetKind;
  stage: AssetStage;
  ready: boolean;
};

/**
 * Every active asset with its stage (bounded by the project's asset count), in kind order
 * (`ASSET_KINDS`) and then display order.
 */
export async function readiness(db: DbExecutor, projectId: string): Promise<ReadinessRow[]> {
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
  const kindIndex = (kind: AssetKind) => ASSET_KINDS.indexOf(kind);
  return [...active]
    .sort(
      (a, b) =>
        kindIndex(a.kind) - kindIndex(b.kind) ||
        a.displayOrder - b.displayOrder ||
        a.id.localeCompare(b.id),
    )
    .map((a) => {
      const { stage } = deriveAssetState(a.kind, looks.get(a.id) ?? null, sheets.get(a.id) ?? null);
      return { id: a.id, name: a.name, kind: a.kind, stage, ready: stage === "ready" };
    });
}

export function summarise(
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

/** Stages that wait for the user: a look or a sheet to review, or a question to answer. */
const TO_REVIEW_STAGES: readonly AssetStage[] = ["look_review", "sheet_review", "needs_answer"];
/** Stages in which a look or a sheet is being made. */
const RENDERING_STAGES: readonly AssetStage[] = ["generating", "building_sheet"];
/** How many busy assets the navigator names; the others are only counted (`moreBusy`). */
export const NAVIGATOR_BUSY_LIMIT = 5;

export type PreProductionNavigator = {
  /** Only kinds that have active assets, in the order of `ASSET_KINDS`. */
  kinds: { kind: AssetKind; toReview: number; rendering: number; failed: number }[];
  /** The first assets whose look or sheet is being made, in the overview's order. */
  busy: { id: string; name: string; kind: AssetKind }[];
  /** Busy assets beyond `busy`. */
  moreBusy: number;
};

/** What the film navigator shows of pre-production, from `readiness` rows (in their order). Pure. */
export function navigatorCounts(
  rows: readonly Pick<ReadinessRow, "id" | "name" | "kind" | "stage">[],
  busyLimit = NAVIGATOR_BUSY_LIMIT,
): PreProductionNavigator {
  const kinds = ASSET_KINDS.flatMap((kind) => {
    const ofKind = rows.filter((r) => r.kind === kind);
    if (ofKind.length === 0) return [];
    const count = (stages: readonly AssetStage[]) =>
      ofKind.filter((r) => stages.includes(r.stage)).length;
    return [
      {
        kind,
        toReview: count(TO_REVIEW_STAGES),
        rendering: count(RENDERING_STAGES),
        failed: count(["failed"]),
      },
    ];
  });
  const busy = rows.filter((r) => RENDERING_STAGES.includes(r.stage));
  const limit = Math.max(0, Math.trunc(busyLimit));
  return {
    kinds,
    busy: busy.slice(0, limit).map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
    moreBusy: Math.max(0, busy.length - limit),
  };
}

/**
 * Per-kind statuses of the project's active assets for the film navigator, and the assets being
 * made. The same three bounded queries as the overview; null when the project is not the user's.
 */
export async function getPreProductionNavigator(
  projectId: string,
  userId: string,
): Promise<PreProductionNavigator | null> {
  const db = getDb();
  if (!(await openProject(db, projectId, userId))) return null;
  return navigatorCounts(await readiness(db, projectId));
}

/**
 * The kind of one of the user's assets (removed ones too), or null when it is not theirs: what
 * the navigator selects on an asset's page. One query on the primary keys.
 */
export async function getAssetKind(assetId: string, userId: string): Promise<AssetKind | null> {
  if (!isUuid(assetId)) return null;
  const [row] = await getDb()
    .select({ kind: asset.kind })
    .from(asset)
    .innerJoin(project, eq(project.id, asset.projectId))
    .where(and(eq(asset.id, assetId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .limit(1);
  return row?.kind ?? null;
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
  // Ownership was checked just above: the page needs no second check.
  const page = await listAssetPage(projectId, { kind, limit, cursor });
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

/**
 * True when this look was started waiting for locations (`asset.look_started` with `waitingFor`)
 * and the wait was never skipped. Reads the project's events of two types from the look's
 * creation on (the `(project, type, created_at)` index).
 */
async function startedWaiting(
  db: DbExecutor,
  row: AssetRow,
  look: Pick<LookView, "id" | "createdAt">,
): Promise<boolean> {
  const events = await db
    .select({
      type: projectEvent.type,
      waitingFor: sql<unknown>`${projectEvent.payload} -> 'waitingFor'`,
    })
    .from(projectEvent)
    .where(
      and(
        eq(projectEvent.projectId, row.projectId),
        inArray(projectEvent.type, ["asset.look_started", "asset.look_wait_skipped"]),
        gte(projectEvent.createdAt, look.createdAt),
        sql`${projectEvent.payload} ->> 'lookId' = ${look.id}`,
      ),
    )
    .limit(10);
  const waited = events.some(
    (e) =>
      e.type === "asset.look_started" && Array.isArray(e.waitingFor) && e.waitingFor.length > 0,
  );
  return waited && !events.some((e) => e.type === "asset.look_wait_skipped");
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
  const untouchedLatest =
    latest !== undefined &&
    latest.status === "pending" &&
    !latest.started &&
    latest.parentId === null &&
    designerFor(row.asset.kind) === "prop";
  const waitingFor = untouchedLatest ? await locationsInFlight(db, row.asset) : [];
  // Its locations settled but the look was never started (the wake was lost): it still waits.
  const canStartWithoutWaiting =
    untouchedLatest && (waitingFor.length > 0 || (await startedWaiting(db, row.asset, latest)));
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
    canStartWithoutWaiting,
    rejectedInARow: since.filter((l) => l.status === "rejected").length,
    packViews,
    lockGate,
    dnaCard,
  };
}
