/**
 * Ownership and stage checks of pre-production, and the first steps of its lock order: the project
 * row (`FOR NO KEY UPDATE`), then the asset row (see the module header in `index.ts`).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor, DbTx } from "@/server/db/client";
import { asset, project } from "@/server/db/schema";
import { assertStageOpen, findOwnedProject } from "@/server/projects";
import type { AssetRow } from "../looks";
import { AssetInputError } from "../service";

export const REMOVED_MESSAGE = "This asset was removed from the project.";

const STAGE_MESSAGE = "Accept a script before starting pre-production.";

const uuid = z.uuid();

export const isUuid = (value: string) => uuid.safeParse(value).success;

type ProjectRow = typeof project.$inferSelect;

/** Throws `AssetInputError` unless the project's pre-production can be opened (also later stages). */
export function assertPreProductionOpen(row: Pick<ProjectRow, "stage">): void {
  assertStageOpen(row, "pre_production", AssetInputError, STAGE_MESSAGE);
}

/**
 * The user's project with pre-production open, or null when not theirs. With `lock`, the project
 * row is locked (`FOR NO KEY UPDATE`: writers of this module exclude each other, while inserts of
 * rows referencing the project elsewhere, such as generations, are not blocked).
 */
export async function openProject(
  db: DbExecutor,
  projectId: string,
  userId: string,
  lock = false,
): Promise<ProjectRow | null> {
  const row = await findOwnedProject(db, projectId, userId, lock ? { lock: "no-key-update" } : {});
  if (!row) return null;
  assertPreProductionOpen(row);
  return row;
}

/**
 * The asset and its project when the user owns it and the stage is open: the project row is
 * locked first, then the asset row (the module's lock order, see the header). A foreign or
 * missing id gives null before anything about the asset is read.
 */
export async function lockAsset(
  tx: DbTx,
  assetId: string,
  userId: string,
): Promise<{ asset: AssetRow; project: ProjectRow } | null> {
  if (!isUuid(assetId)) return null;
  const [target] = await tx
    .select({ projectId: asset.projectId })
    .from(asset)
    .where(eq(asset.id, assetId))
    .limit(1);
  if (!target) return null;
  const owner = await openProject(tx, target.projectId, userId, true);
  if (!owner) return null;
  const [row] = await tx
    .select()
    .from(asset)
    .where(and(eq(asset.id, assetId), eq(asset.projectId, owner.id)))
    .for("update");
  if (!row) return null;
  return { asset: row, project: owner };
}

export function assertActive(row: AssetRow): void {
  if (row.status !== "active") throw new AssetInputError(REMOVED_MESSAGE);
}
