/**
 * Ownership and stage checks shared by Production's services, and the locking order they follow:
 * the project row first (as block replacement and asset merges do), then the lineage's current
 * block row. Not exported from the module index.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getCurrentBlock, type PromptBlock } from "@/server/blocks";
import type { DbExecutor, DbTx } from "@/server/db/client";
import { project, WIZARD_STAGES, type WizardStage } from "@/server/db/schema";
import { canOpenStage } from "@/server/projects";
import { ProductionInputError } from "./errors";

export type ProjectRow = typeof project.$inferSelect;

export const STAGE_MESSAGE = "Finish pre-production before starting production.";
export const STALE_MESSAGE =
  "The script changed under this shot. Wait until the shots are updated, then try again.";

const uuid = z.uuid();
export const isUuid = (value: string) => uuid.safeParse(value).success;
export const userIdSchema = z.string().trim().min(1).max(128);

/** Validates input; the first issue's message becomes a `ProductionInputError`. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ProductionInputError(result.error.issues[0]?.message ?? "That input is not valid.");
  }
  return result.data;
}

/** Wizard projects open Production once pre-production is complete (and keep it open when done). */
export function assertProductionOpen(row: Pick<ProjectRow, "stage">): void {
  const wizardStage = (WIZARD_STAGES as readonly string[]).includes(row.stage);
  if (wizardStage && !canOpenStage(row, "production" satisfies WizardStage)) {
    throw new ProductionInputError(STAGE_MESSAGE);
  }
}

/** The user's project with Production open (row-locked with `lock`), or null when not theirs. */
export async function openProject(
  db: DbExecutor,
  projectId: string,
  userId: string,
  lock = false,
): Promise<ProjectRow | null> {
  if (!isUuid(projectId)) return null;
  const query = db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) return null;
  assertProductionOpen(row);
  return row;
}

/** The lineage's current block and its project when the user owns it (no locks). */
export async function openLineage(
  db: DbExecutor,
  lineageId: string,
  userId: string,
): Promise<{ project: ProjectRow; block: PromptBlock } | null> {
  if (!isUuid(lineageId)) return null;
  const block = await getCurrentBlock(lineageId, db);
  if (!block) return null;
  const owned = await openProject(db, block.projectId, userId);
  if (!owned) return null;
  return { project: owned, block };
}

/**
 * Locks the project, then the lineage's current block, inside the caller's transaction. Null when
 * the lineage is not the user's (or has no current block any more).
 */
export async function lockLineage(
  tx: DbTx,
  lineageId: string,
  userId: string,
): Promise<{ project: ProjectRow; block: PromptBlock } | null> {
  if (!isUuid(lineageId)) return null;
  const first = await getCurrentBlock(lineageId, tx);
  if (!first) return null;
  const owned = await openProject(tx, first.projectId, userId, true);
  if (!owned) return null;
  const block = await getCurrentBlock(lineageId, tx, true);
  if (!block || block.projectId !== owned.id) return null;
  return { project: owned, block };
}
