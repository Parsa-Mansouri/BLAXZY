/**
 * New versions of looks, sheets and pack views: each takes its parent's next version number. The
 * caller holds the asset lock (`lockAsset`), which serialises every writer of these rows.
 */
import { and, eq, max, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DbTx } from "@/server/db/client";
import { assetLook, assetSheet, assetSheetView } from "@/server/db/schema";
import type { LookRow, SheetRow } from "../looks";
import type { PackViewRow } from "../packs";

/** `max(column) + 1` over the rows matching `where` (1 for the first version). */
async function nextVersionNumber(
  tx: DbTx,
  table: PgTable,
  column: AnyPgColumn<{ data: number }>,
  where: SQL | undefined,
): Promise<number> {
  const [row] = await tx
    .select({ n: max(column) })
    .from(table)
    .where(where);
  return (row?.n ?? 0) + 1;
}

async function nextLookNumber(tx: DbTx, assetId: string): Promise<number> {
  return nextVersionNumber(tx, assetLook, assetLook.versionNumber, eq(assetLook.assetId, assetId));
}

async function nextSheetNumber(tx: DbTx, assetId: string): Promise<number> {
  return nextVersionNumber(
    tx,
    assetSheet,
    assetSheet.versionNumber,
    eq(assetSheet.assetId, assetId),
  );
}

export async function insertLook(
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

export async function insertSheet(
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

export async function insertViewVersion(
  tx: DbTx,
  parent: PackViewRow,
  values: Partial<typeof assetSheetView.$inferInsert>,
): Promise<PackViewRow> {
  const versionNumber = await nextVersionNumber(
    tx,
    assetSheetView,
    assetSheetView.versionNumber,
    and(eq(assetSheetView.sheetId, parent.sheetId), eq(assetSheetView.viewId, parent.viewId)),
  );
  const [row] = await tx
    .insert(assetSheetView)
    .values({
      sheetId: parent.sheetId,
      assetId: parent.assetId,
      projectId: parent.projectId,
      viewId: parent.viewId,
      versionNumber,
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
