/** Reading packs: the latest views of a sheet, the screens' view of them and a job's context. */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/server/db/client";
import {
  asset,
  assetLook,
  assetSheet,
  assetSheetView,
  damiRun,
  generation,
  project,
  review,
  type ReviewFixRequest,
} from "@/server/db/schema";
import { type AssetRow, isSampleOutput, type LookRow, type SheetRow } from "../looks";
import type { PackView, PackViewRow } from "./rules";

/**
 * The latest version of every view of a sheet, in generation order. Not truncated: the set is
 * bounded by the plan (`storePackPlan` refuses more than `MAX_VIEWS` views), and a LIMIT here
 * would silently drop views of a pack (by view id, not by position).
 */
export async function latestViewRows(db: DbExecutor, sheetId: string): Promise<PackViewRow[]> {
  const rows = await db
    .selectDistinctOn([assetSheetView.viewId])
    .from(assetSheetView)
    .where(eq(assetSheetView.sheetId, sheetId))
    .orderBy(assetSheetView.viewId, desc(assetSheetView.versionNumber));
  return rows.sort((a, b) => a.position - b.position || a.viewId.localeCompare(b.viewId));
}

/** The pack's views for a screen, with their sample flag and what they wait for. */
export async function listPackViews(db: DbExecutor, sheetId: string): Promise<PackView[]> {
  const rows = await latestViewRows(db, sheetId);
  if (rows.length === 0) return [];
  const meta = await db
    .select({ id: assetSheetView.id, provider: generation.provider, model: damiRun.model })
    .from(assetSheetView)
    .leftJoin(generation, eq(generation.id, assetSheetView.generationId))
    .leftJoin(damiRun, eq(damiRun.id, assetSheetView.damiRunId))
    .where(
      inArray(
        assetSheetView.id,
        rows.map((r) => r.id),
      ),
    );
  const byId = new Map(meta.map((m) => [m.id, m]));
  const byViewId = new Map(rows.map((r) => [r.viewId, r]));
  return rows.map((row): PackView => {
    const m = byId.get(row.id);
    const sample = isSampleOutput(m?.provider, m?.model);
    return {
      id: row.id,
      viewId: row.viewId,
      versionNumber: row.versionNumber,
      label: row.label,
      position: row.position,
      status: row.status,
      purpose: row.purpose,
      fileId: row.fileId,
      aspectRatio: row.aspectRatio,
      mustShow: row.mustShow,
      mustNotShow: row.mustNotShow,
      reviewFocus: row.reviewFocus,
      newHypotheses: row.newHypotheses,
      editMode: row.editMode,
      warnings: row.warnings,
      waitingFor: row.dependsOn
        .map((d) => byViewId.get(d))
        .filter((d): d is PackViewRow => d !== undefined && d.status !== "accepted")
        .map((d) => d.label),
      parentId: row.parentId,
      failure: row.failure,
      isSample: sample,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    };
  });
}

export type PackJobContext = {
  sheet: SheetRow;
  look: LookRow;
  asset: AssetRow;
  project: { id: string; ownerId: string; style: typeof project.$inferSelect.style };
  views: PackViewRow[];
};

/** Everything a pack job needs, or null when the sheet, its look or its project is gone. */
export async function loadPackJob(sheetId: string): Promise<PackJobContext | null> {
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
  return {
    sheet: row.sheet,
    look: row.look,
    asset: row.asset,
    project: { id: row.project.id, ownerId: row.project.ownerId, style: row.project.style },
    views: await latestViewRows(db, sheetId),
  };
}

/** The review that rejected a view version (its fix requests), or null. */
export async function loadViewRejection(
  viewRowId: string,
): Promise<{ fixRequests: ReviewFixRequest[]; note: string | null } | null> {
  const [row] = await getDb()
    .select({ fixRequests: review.fixRequests, note: review.note })
    .from(review)
    .where(
      and(
        eq(review.subjectType, "asset_sheet_view"),
        eq(review.subjectId, viewRowId),
        eq(review.decision, "rejected"),
      ),
    )
    .orderBy(desc(review.createdAt))
    .limit(1);
  return row ?? null;
}

export async function loadViewRow(viewRowId: string): Promise<PackViewRow | null> {
  const [row] = await getDb()
    .select()
    .from(assetSheetView)
    .where(eq(assetSheetView.id, viewRowId))
    .limit(1);
  return row ?? null;
}

/** The accepted views of the accepted packs of these assets (Production's per-shot references). */
export async function acceptedPackViews(
  db: DbExecutor,
  sheetIds: readonly string[],
): Promise<Map<string, { viewId: string; label: string; fileId: string }[]>> {
  const out = new Map<string, { viewId: string; label: string; fileId: string }[]>();
  if (sheetIds.length === 0) return out;
  const rows = await db
    .select({
      sheetId: assetSheetView.sheetId,
      viewId: assetSheetView.viewId,
      label: assetSheetView.label,
      fileId: assetSheetView.fileId,
    })
    .from(assetSheetView)
    .where(
      and(inArray(assetSheetView.sheetId, [...sheetIds]), eq(assetSheetView.status, "accepted")),
    )
    .orderBy(asc(assetSheetView.position));
  for (const r of rows) {
    if (!r.fileId) continue;
    const views = out.get(r.sheetId) ?? [];
    views.push({ viewId: r.viewId, label: r.label, fileId: r.fileId });
    out.set(r.sheetId, views);
  }
  return out;
}
