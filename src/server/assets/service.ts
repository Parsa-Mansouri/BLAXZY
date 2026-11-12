import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { SectionerAsset } from "@/server/damis";
import { getDb } from "@/server/db/client";
import { ASSET_KINDS, asset, project, type AssetKind } from "@/server/db/schema";

export type Asset = typeof asset.$inferSelect;

export const DEFAULT_ASSET_PAGE_SIZE = 50;
export const MAX_ASSET_PAGE_SIZE = 200;
/** The dami input limit for known and sectioner assets. */
const MAX_DAMI_ASSETS = 500;

/** Thrown for input the caller can fix; `message` is safe to show. */
export class AssetInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetInputError";
  }
}

const uuid = z.uuid();

/** Validates input; the first issue's message becomes an `AssetInputError`. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AssetInputError(result.error.issues[0]?.message ?? "That input is not valid.");
  }
  return result.data;
}

const listAssetsSchema = z.object({
  kind: z.enum(ASSET_KINDS).optional(),
  includeRemoved: z.boolean().default(false),
  limit: z.number().int().min(1).max(MAX_ASSET_PAGE_SIZE).default(DEFAULT_ASSET_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
});

/** The active assets, as the prompt-sectioner's asset list. */
export async function getSectionerAssets(projectId: string): Promise<SectionerAsset[]> {
  return getDb()
    .select({
      kind: asset.kind,
      name: asset.name,
      description: asset.description,
    })
    .from(asset)
    .where(and(eq(asset.projectId, projectId), eq(asset.status, "active")))
    .orderBy(asc(asset.displayOrder), asc(asset.id))
    .limit(MAX_DAMI_ASSETS);
}

async function ownsProject(projectId: string, userId: string): Promise<boolean> {
  if (!uuid.safeParse(projectId).success) return false;
  const [row] = await getDb()
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .limit(1);
  return row !== undefined;
}

function encodeCursor(order: number, id: string): string {
  return Buffer.from(`${order}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { order: number; id: string } {
  const [order, id, ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const value = Number(order);
  if (rest.length > 0 || !Number.isInteger(value) || !uuid.safeParse(id).success) {
    throw new AssetInputError("That page link is no longer valid. Reload the list.");
  }
  return { order: value, id: id as string };
}

/** The project's assets (active only unless `includeRemoved`), in display order, paginated. */
export async function listAssets(
  projectId: string,
  userId: string,
  opts: {
    kind?: AssetKind;
    includeRemoved?: boolean;
    limit?: number;
    cursor?: string | null;
  } = {},
): Promise<{ items: Asset[]; nextCursor: string | null } | null> {
  const { kind, includeRemoved, limit, cursor } = parse(listAssetsSchema, opts);
  if (!(await ownsProject(projectId, userId))) return null;
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await getDb()
    .select()
    .from(asset)
    .where(
      and(
        eq(asset.projectId, projectId),
        kind ? eq(asset.kind, kind) : undefined,
        includeRemoved ? undefined : eq(asset.status, "active"),
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
    nextCursor: rows.length > limit && last ? encodeCursor(last.displayOrder, last.id) : null,
  };
}

/** Active assets per kind (every kind present, zero when none). */
export async function countAssetsByKind(
  projectId: string,
  userId: string,
): Promise<Record<AssetKind, number> | null> {
  if (!(await ownsProject(projectId, userId))) return null;
  const rows = await getDb()
    .select({ kind: asset.kind, n: count() })
    .from(asset)
    .where(and(eq(asset.projectId, projectId), eq(asset.status, "active")))
    .groupBy(asset.kind);
  const counts = Object.fromEntries(ASSET_KINDS.map((k) => [k, 0])) as Record<AssetKind, number>;
  for (const row of rows) counts[row.kind] = row.n;
  return counts;
}
