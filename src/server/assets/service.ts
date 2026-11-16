import { and, asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { ASSET_KINDS, asset, type AssetKind } from "@/server/db/schema";
import { makeParser, UserInputError } from "@/server/errors";
import { findOwnedProject } from "@/server/projects";
import { decodeOrderCursor, encodeOrderCursor } from "@/server/projects/cursor";

export type Asset = typeof asset.$inferSelect;

export const DEFAULT_ASSET_PAGE_SIZE = 50;
export const MAX_ASSET_PAGE_SIZE = 200;

/** Thrown for input the caller can fix; `message` is safe to show. */
export class AssetInputError extends UserInputError {
  constructor(message: string) {
    super(message);
    this.name = "AssetInputError";
  }
}

/**
 * Excludes the characters that are only a voice (`details.needsVisual` false, detector v2's
 * `voice_only`): nothing is designed for them in Pre-production, so they are neither listed,
 * counted, nor waited for. Rows without the flag (every older row) count as visual.
 */
export const needsVisualAsset = sql`coalesce(${asset.details}->>'needsVisual', 'true') <> 'false'`;

/** Validates input; the first issue's message becomes an `AssetInputError`. */
export const parse = makeParser(AssetInputError);

const listAssetsSchema = z.object({
  kind: z.enum(ASSET_KINDS).optional(),
  includeRemoved: z.boolean().default(false),
  /** Also the characters that are only a voice (hidden from Pre-production by default). */
  includeVoiceOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(MAX_ASSET_PAGE_SIZE).default(DEFAULT_ASSET_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
});

async function ownsProject(projectId: string, userId: string): Promise<boolean> {
  return (await findOwnedProject(getDb(), projectId, userId)) !== null;
}

/** `(displayOrder, id)` keyset cursor, in the shared order-cursor format (`@/server/projects/cursor`). */
function decodeCursor(cursor: string): { order: number; id: string } {
  const decoded = decodeOrderCursor(cursor);
  if (!decoded) throw new AssetInputError("That page link is no longer valid. Reload the list.");
  return { order: decoded.orderIndex, id: decoded.id };
}

/** The project's assets (active only unless `includeRemoved`), in display order, paginated. */
export async function listAssets(
  projectId: string,
  userId: string,
  opts: {
    kind?: AssetKind;
    includeRemoved?: boolean;
    includeVoiceOnly?: boolean;
    limit?: number;
    cursor?: string | null;
  } = {},
): Promise<{ items: Asset[]; nextCursor: string | null } | null> {
  const parsed = parse(listAssetsSchema, opts);
  if (!(await ownsProject(projectId, userId))) return null;
  return listAssetPage(projectId, parsed);
}

/**
 * One page of the project's assets with no ownership check: for services that have just checked
 * the project themselves (`listAssetCards`). Not exported from the module index.
 */
export async function listAssetPage(
  projectId: string,
  opts: {
    kind?: AssetKind;
    includeRemoved?: boolean;
    includeVoiceOnly?: boolean;
    limit?: number;
    cursor?: string | null;
  },
): Promise<{ items: Asset[]; nextCursor: string | null }> {
  const { kind, includeRemoved, includeVoiceOnly, limit, cursor } = parse(listAssetsSchema, opts);
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await getDb()
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.projectId, projectId),
        kind ? eq(asset.kind, kind) : undefined,
        includeRemoved ? undefined : eq(asset.status, "active"),
        includeVoiceOnly ? undefined : needsVisualAsset,
        after
          ? sql`(${asset.displayOrder}, ${asset.id}) > (${after.order}, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(asset.displayOrder), asc(asset.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeOrderCursor(last.displayOrder, last.id) : null,
  };
}

/** Active assets per kind (every kind present, zero when none), voice-only characters left out. */
export async function countAssetsByKind(
  projectId: string,
  userId: string,
): Promise<Record<AssetKind, number> | null> {
  if (!(await ownsProject(projectId, userId))) return null;
  const rows = await getDb()
    .select({ kind: asset.kind, n: count() })
    .from(asset)
    .where(and(eq(asset.projectId, projectId), eq(asset.status, "active"), needsVisualAsset))
    .groupBy(asset.kind);
  const counts = Object.fromEntries(ASSET_KINDS.map((k) => [k, 0])) as Record<AssetKind, number>;
  for (const row of rows) counts[row.kind] = row.n;
  return counts;
}
