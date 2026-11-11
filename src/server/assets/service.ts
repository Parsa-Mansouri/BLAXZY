import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DetectedAsset, KnownAsset, SectionerAsset } from "@/server/damis";
import { getDb } from "@/server/db/client";
import { ASSET_KINDS, asset, project, projectEvent, type AssetKind } from "@/server/db/schema";

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

const detectedSchema = z.object({
  kind: z.enum(ASSET_KINDS),
  name: z.string().trim().min(1).max(200),
  slug: z.string().min(1).max(48),
  description: z.string().trim().max(4000),
});

const applyDetectionSchema = z.object({
  projectId: uuid,
  scriptVersionId: uuid,
  damiRunId: uuid,
  assets: z.array(detectedSchema).max(1000),
});

const listAssetsSchema = z.object({
  kind: z.enum(ASSET_KINDS).optional(),
  includeRemoved: z.boolean().default(false),
  limit: z.number().int().min(1).max(MAX_ASSET_PAGE_SIZE).default(DEFAULT_ASSET_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
});

/**
 * Applies one detection result as a diff by (kind, slug), in one transaction: new assets are
 * inserted active; present ones get the new name/description/lastScriptVersionId (and are
 * reactivated if removed); detected assets missing from the result become `removed`. Manual
 * assets are never changed. Logs `assets.detected`, which also marks the version as detected.
 */
export async function applyDetection(input: {
  projectId: string;
  scriptVersionId: string;
  damiRunId: string;
  assets: DetectedAsset[];
}): Promise<{ added: number; kept: number; removed: number }> {
  const { projectId, scriptVersionId, damiRunId, assets } = parse(applyDetectionSchema, input);
  return getDb().transaction(async (tx) => {
    const [owner] = await tx
      .select({ ownerId: project.ownerId })
      .from(project)
      .where(eq(project.id, projectId))
      .for("update");
    if (!owner) throw new AssetInputError("That project does not exist.");

    const existing = await tx.select().from(asset).where(eq(asset.projectId, projectId));
    const byKey = new Map(existing.map((a) => [`${a.kind}:${a.slug}`, a]));
    const seen = new Set<string>();
    let added = 0;
    let kept = 0;

    for (const [index, detected] of assets.entries()) {
      const key = `${detected.kind}:${detected.slug}`;
      if (seen.has(key)) continue; // the dami's check forbids duplicates; first one wins
      seen.add(key);
      const found = byKey.get(key);
      if (!found) {
        await tx.insert(asset).values({
          projectId,
          kind: detected.kind,
          name: detected.name,
          slug: detected.slug,
          description: detected.description || null,
          status: "active",
          origin: "detected",
          displayOrder: index,
          firstScriptVersionId: scriptVersionId,
          lastScriptVersionId: scriptVersionId,
          damiRunId,
        });
        added++;
        continue;
      }
      kept++;
      if (found.origin === "manual") continue;
      await tx
        .update(asset)
        .set({
          name: detected.name,
          description: detected.description || null,
          status: "active",
          displayOrder: index,
          lastScriptVersionId: scriptVersionId,
          damiRunId,
        })
        .where(eq(asset.id, found.id));
    }

    const gone = existing.filter(
      (a) => a.origin === "detected" && a.status === "active" && !seen.has(`${a.kind}:${a.slug}`),
    );
    if (gone.length > 0) {
      await tx
        .update(asset)
        .set({ status: "removed" })
        .where(
          inArray(
            asset.id,
            gone.map((a) => a.id),
          ),
        );
    }
    const result = { added, kept, removed: gone.length };
    await tx.insert(projectEvent).values({
      projectId,
      userId: owner.ownerId,
      type: "assets.detected",
      payload: { scriptVersionId, damiRunId, ...result },
    });
    return result;
  });
}

/** True when a detection result for this script version has been applied. */
export async function hasDetectionFor(
  projectId: string,
  scriptVersionId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: projectEvent.id })
    .from(projectEvent)
    .where(
      and(
        eq(projectEvent.projectId, projectId),
        eq(projectEvent.type, "assets.detected"),
        sql`${projectEvent.payload}->>'scriptVersionId' = ${scriptVersionId}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Every stored asset (removed ones too), as the detector's `knownAssets`. */
export async function getKnownAssets(projectId: string): Promise<KnownAsset[]> {
  const rows = await getDb()
    .select({
      kind: asset.kind,
      name: asset.name,
      slug: asset.slug,
      description: asset.description,
    })
    .from(asset)
    .where(eq(asset.projectId, projectId))
    .orderBy(asc(asset.status), asc(asset.displayOrder), asc(asset.id))
    .limit(MAX_DAMI_ASSETS);
  return rows;
}

/** The active assets, as the prompt-sectioner's asset list. */
export async function getSectionerAssets(projectId: string): Promise<SectionerAsset[]> {
  return getDb()
    .select({
      kind: asset.kind,
      slug: asset.slug,
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
