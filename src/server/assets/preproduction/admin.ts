/** Managing assets by hand: add, rename, include again, remove and merge. */
import { and, asc, eq, gt, inArray, max, ne, sql } from "drizzle-orm";
import { rewriteAssetRefs } from "@/server/blocks";
import { formatAssetRef, uniqueName } from "@/server/damis";
import { type DbTx, getDb } from "@/server/db/client";
import { asset, type AssetKind } from "@/server/db/schema";
import { logProjectEvent } from "@/server/projects";
import { markRemovedByUser, removedByUser } from "../detection";
import { type Asset, AssetInputError, parse } from "../service";
import { assertActive, isUuid, lockAsset, openProject, REMOVED_MESSAGE } from "./access";
import { wakeOnTx } from "./enqueue";
import {
  addInput,
  assetRefInput,
  DUPLICATE_ADD_WINDOW_SECONDS,
  mergeInput,
  updateInput,
} from "./inputs";

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
 * cleaned and made unique in its kind: a second "Mara" becomes "Mara (2)". A double submit (the
 * same name, ignoring case, added by hand to this project within `DUPLICATE_ADD_WINDOW_SECONDS`;
 * only the owner adds by hand) returns the asset just added instead; the project lock serialises
 * the two requests, so the second always sees the first.
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
    const [justAdded] = await tx
      .select()
      .from(asset)
      .where(
        and(
          eq(asset.projectId, projectId),
          eq(asset.kind, kind),
          sql`lower(${asset.name}) = lower(${given})`,
          eq(asset.origin, "manual"),
          eq(asset.status, "active"),
          gt(asset.createdAt, sql`now() - make_interval(secs => ${DUPLICATE_ADD_WINDOW_SECONDS})`),
        ),
      )
      .limit(1);
    if (justAdded) return justAdded;
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
    await logProjectEvent(tx, {
      projectId,
      userId,
      type: "asset.added",
      payload: { assetId: row.id, kind, name },
    });
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
    // Project first (as block rewrites do), then the asset: `lockAsset` takes them in that order.
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
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.updated",
      payload: {
        assetId,
        name: name !== undefined,
        description: description !== undefined,
        ...(name !== undefined ? { from: row.name, to: name, blocksRewritten } : {}),
      },
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
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.included",
      payload: { assetId, priority },
    });
    return updated ?? null;
  });
}

/**
 * Marks an asset removed (kept, never deleted) and records that the user removed it
 * (`details.removedBy`), so a later detection never brings it back. True when it is removed (also
 * if it already was). Props waiting for a removed location are woken in the same transaction.
 */
export async function removeAsset(input: { assetId: string; userId: string }): Promise<boolean> {
  const { assetId, userId } = parse(assetRefInput, input);
  if (!isUuid(assetId)) return false;
  const removed = await getDb().transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return false;
    const { asset: row } = locked;
    if (removedByUser(row)) return true;
    // Removed by the detector before: now the user's choice too (never revived).
    await tx
      .update(asset)
      .set({ status: "removed", details: markRemovedByUser(row.details) })
      .where(eq(asset.id, assetId));
    if (row.status === "removed") return true;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.removed",
      payload: {
        assetId,
        kind: row.kind,
        name: row.name,
      },
    });
    // Props waiting for a removed location go ahead without it.
    if (row.kind === "location") await wakeOnTx(tx, row.projectId);
    return true;
  });
  return removed;
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
    // Merged away by the user: a later detection never revives it (`details.removedBy`).
    await tx
      .update(asset)
      .set({ status: "removed", details: markRemovedByUser(merged.details) })
      .where(eq(asset.id, mergeId));
    const blocksRewritten = await rewriteAssetRefs(
      {
        projectId: keep.projectId,
        from: formatAssetRef(merged.kind, merged.name),
        to: formatAssetRef(keep.kind, keep.name),
      },
      tx,
    );
    await logProjectEvent(tx, {
      projectId: keep.projectId,
      userId,
      type: "asset.merged",
      payload: {
        keepId,
        mergeId,
        kind: keep.kind,
        keepName: keep.name,
        mergeName: merged.name,
        blocksRewritten,
      },
    });
    // Props waiting for the merged-away location go ahead (the kept one may be done already).
    if (merged.kind === "location") await wakeOnTx(tx, keep.projectId);
    return keep;
  });
}
