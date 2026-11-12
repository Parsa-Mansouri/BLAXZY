/**
 * Assets as Production references: which assets are ready to be attached to a block, and the file
 * each one is attached with (the accepted sheet, else the accepted look). Read-only; no ownership
 * checks (callers have checked the project).
 */
import { and, asc, eq, inArray, ne, or } from "drizzle-orm";
import { getDb, type DbExecutor } from "@/server/db/client";
import { formatAssetRef, parseAssetRef, type ParsedAssetRef } from "@/server/damis";
import { asset, type AssetKind } from "@/server/db/schema";
import { latestByAsset, newestLookWithStatus, newestSheetWithStatus, type AssetRow } from "./looks";
import { deriveAssetState } from "./stage";

/** An asset as a block reference. `ref` is `kind:Name`. */
export type ReferenceAsset = {
  ref: string;
  assetId: string;
  kind: AssetKind;
  name: string;
  description: string;
  /** Active (not removed) and ready in pre-production. */
  ready: boolean;
  /** What generation attaches: the accepted sheet's file, else the accepted look's (null for voices or when not ready). */
  referenceFileId: string | null;
  /** What the screens show: the accepted sheet, else the accepted look. */
  thumbnailFileId: string | null;
};

/** The most assets one project hands to Production at once (the damis' input limit). */
const MAX_REFERENCE_ASSETS = 500;

export { parseAssetRef };

async function describe(db: DbExecutor, rows: AssetRow[]): Promise<ReferenceAsset[]> {
  const ids = rows.map((r) => r.id);
  const { looks, sheets } = await latestByAsset(db, ids);
  const acceptedSheets = await newestSheetWithStatus(db, ids, "accepted");
  const acceptedLooks = await newestLookWithStatus(db, ids, "accepted");
  return rows.map((row) => {
    const ready =
      row.status === "active" &&
      deriveAssetState(row.kind, looks.get(row.id) ?? null, sheets.get(row.id) ?? null).stage ===
        "ready";
    const look = acceptedLooks.get(row.id) ?? null;
    // Only the sheet built from the accepted look counts.
    const sheet = acceptedSheets.get(row.id);
    const sheetFileId = sheet && look && sheet.lookId === look.id ? sheet.fileId : null;
    const imageFileId = row.kind === "voice" ? null : (sheetFileId ?? look?.fileId ?? null);
    return {
      ref: formatAssetRef(row.kind, row.name),
      assetId: row.id,
      kind: row.kind,
      name: row.name,
      description: row.description ?? "",
      ready,
      referenceFileId: ready ? imageFileId : null,
      thumbnailFileId: imageFileId,
    };
  });
}

/** The project's ready image assets (voices excluded), in display order: what a block may reference. */
export async function listReadyReferenceAssets(
  projectId: string,
  db: DbExecutor = getDb(),
): Promise<ReferenceAsset[]> {
  const rows = await db
    .select()
    .from(asset)
    .where(and(eq(asset.projectId, projectId), eq(asset.status, "active"), ne(asset.kind, "voice")))
    .orderBy(asc(asset.displayOrder), asc(asset.id))
    .limit(MAX_REFERENCE_ASSETS);
  return (await describe(db, rows)).filter((a) => a.ready && a.referenceFileId !== null);
}

/** The project's assets named by `kind:Name` refs (removed ones too), keyed by ref. */
export async function describeAssetRefs(
  projectId: string,
  refs: readonly string[],
  db: DbExecutor = getDb(),
): Promise<Map<string, ReferenceAsset>> {
  const parsed = [...new Set(refs)]
    .map(parseAssetRef)
    .filter((r): r is ParsedAssetRef => r !== null)
    .slice(0, MAX_REFERENCE_ASSETS);
  if (parsed.length === 0) return new Map();
  const rows = await db
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.projectId, projectId),
        or(...parsed.map((r) => and(eq(asset.kind, r.kind), eq(asset.name, r.name)))),
      ),
    );
  return new Map((await describe(db, rows)).map((a) => [a.ref, a]));
}

/** The project's assets with these ids (removed ones too), keyed by id. */
export async function describeAssetsById(
  projectId: string,
  assetIds: readonly string[],
  db: DbExecutor = getDb(),
): Promise<Map<string, ReferenceAsset>> {
  const ids = [...new Set(assetIds)].slice(0, MAX_REFERENCE_ASSETS);
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(asset)
    .where(and(eq(asset.projectId, projectId), inArray(asset.id, ids)));
  return new Map((await describe(db, rows)).map((a) => [a.assetId, a]));
}
