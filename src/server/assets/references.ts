/**
 * Assets as Production references: which assets are ready to be attached to a block, and the file
 * each one is attached with. Characters are attached with their accepted sheet; locations and props
 * with their approved Hero (one image), and the approved views of their locked pack are listed in
 * `views` for shots that need another angle. Read-only; no ownership checks (callers have checked
 * the project).
 */
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { getDb, type DbExecutor } from "@/server/db/client";
import { formatAssetRef, nameKey, parseAssetRef, type ParsedAssetRef } from "@/server/damis";
import { asset, type AssetKind } from "@/server/db/schema";
import { latestByAsset, newestLookWithStatus, newestSheetWithStatus, type AssetRow } from "./looks";
import { acceptedPackViews, packKindOf } from "./packs";
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
  /**
   * What generation attaches (null for voices or when not ready): a character's accepted sheet
   * (else its accepted look); a location's or prop's approved Hero.
   */
  referenceFileId: string | null;
  /** What the screens show: the accepted sheet, else the accepted look (a location's or prop's Hero). */
  thumbnailFileId: string | null;
  /** Locations and props: the approved views of the locked pack, in order (for later use per shot). */
  views: { viewId: string; label: string; fileId: string }[];
};

/** The most assets one project hands to Production at once (the damis' input limit). */
const MAX_REFERENCE_ASSETS = 500;

export { parseAssetRef };

async function describe(db: DbExecutor, rows: AssetRow[]): Promise<ReferenceAsset[]> {
  const ids = rows.map((r) => r.id);
  const { looks, sheets } = await latestByAsset(db, ids);
  const acceptedSheets = await newestSheetWithStatus(db, ids, "accepted");
  const acceptedLooks = await newestLookWithStatus(db, ids, "accepted");
  const packViews = await acceptedPackViews(
    db,
    rows.flatMap((r) => {
      const sheet = acceptedSheets.get(r.id);
      return packKindOf(r.kind) && sheet ? [sheet.id] : [];
    }),
  );
  return rows.map((row) => {
    const ready =
      row.status === "active" &&
      deriveAssetState(row.kind, looks.get(row.id) ?? null, sheets.get(row.id) ?? null).stage ===
        "ready";
    const look = acceptedLooks.get(row.id) ?? null;
    // Only the sheet built from the accepted look counts.
    const sheet = acceptedSheets.get(row.id);
    const ownSheet = sheet && look && sheet.lookId === look.id ? sheet : null;
    const pack = packKindOf(row.kind) !== null;
    const imageFileId =
      row.kind === "voice"
        ? null
        : pack
          ? (look?.fileId ?? null)
          : (ownSheet?.fileId ?? look?.fileId ?? null);
    return {
      ref: formatAssetRef(row.kind, row.name),
      assetId: row.id,
      kind: row.kind,
      name: row.name,
      description: row.description ?? "",
      ready,
      referenceFileId: ready ? imageFileId : null,
      thumbnailFileId: imageFileId,
      views: ready && pack && ownSheet ? (packViews.get(ownSheet.id) ?? []) : [],
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

/**
 * The project's assets named by `kind:Name` refs (removed ones too), keyed by ref. Names match
 * ignoring case, as they are unique (the `(project, kind, lower(name))` index serves the lookup):
 * each asset is keyed by its own ref and by every requested ref that names it.
 */
export async function describeAssetRefs(
  projectId: string,
  refs: readonly string[],
  db: DbExecutor = getDb(),
): Promise<Map<string, ReferenceAsset>> {
  const requested = [...new Set(refs)]
    .map((ref) => ({ ref, parsed: parseAssetRef(ref) }))
    .filter((r): r is { ref: string; parsed: ParsedAssetRef } => r.parsed !== null)
    .slice(0, MAX_REFERENCE_ASSETS);
  if (requested.length === 0) return new Map();
  const rows = await db
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.projectId, projectId),
        or(
          ...requested.map(({ parsed: r }) =>
            and(eq(asset.kind, r.kind), sql`lower(${asset.name}) = lower(${r.name})`),
          ),
        ),
      ),
    );
  const described = await describe(db, rows);
  const byKey = new Map(described.map((a) => [`${a.kind}:${nameKey(a.name)}`, a]));
  const out = new Map(described.map((a) => [a.ref, a]));
  for (const { ref, parsed } of requested) {
    const found = byKey.get(`${parsed.kind}:${nameKey(parsed.name)}`);
    if (found) out.set(ref, found);
  }
  return out;
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
