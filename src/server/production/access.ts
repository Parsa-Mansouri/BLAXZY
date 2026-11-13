/**
 * Ownership and stage checks shared by Production's services, and the locking order they follow:
 * the project row first (as block replacement and asset merges do), then the lineage's current
 * block row. Not exported from the module index.
 */
import { z } from "zod";
import { getCurrentBlock, type PromptBlock } from "@/server/blocks";
import type { DbExecutor, DbTx } from "@/server/db/client";
import type { project, ProjectStyle } from "@/server/db/schema";
import { makeParser } from "@/server/errors";
import { assertStageOpen, findOwnedProject } from "@/server/projects";
import { ProductionInputError } from "./errors";
import { NEEDS_REASON } from "./messages";
import { deriveBlockStage, type BlockProductionStage } from "./stage";
import { latestLiveTake, type TakeRow } from "./takes";

export type ProjectRow = typeof project.$inferSelect;

export const STAGE_MESSAGE = "Finish pre-production before starting production.";
export const STALE_MESSAGE =
  "The script changed under this shot. Wait until the shots are updated, then try again.";

const uuid = z.uuid();
export const isUuid = (value: string) => uuid.safeParse(value).success;
export const userIdSchema = z.string().trim().min(1).max(128);

/** Validates input; the first issue's message becomes a `ProductionInputError`. */
export const parse = makeParser(ProductionInputError);

/** Wizard projects open Production once pre-production is complete (and keep it open when done). */
export function assertProductionOpen(row: Pick<ProjectRow, "stage">): void {
  assertStageOpen(row, "production", ProductionInputError, STAGE_MESSAGE);
}

/** The user's project with Production open (row-locked with `lock`), or null when not theirs. */
export async function openProject(
  db: DbExecutor,
  projectId: string,
  userId: string,
  lock = false,
): Promise<ProjectRow | null> {
  const row = await findOwnedProject(db, projectId, userId, lock ? { lock: "update" } : {});
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

export function requireStyle(row: ProjectRow): ProjectStyle {
  if (!row.style) throw new ProductionInputError("Choose the project's style first.");
  return row.style;
}

/** Production's writes need the project in the production stage (or done, when revisiting). */
export function assertWritable(row: ProjectRow): void {
  if (row.stage !== "production" && row.stage !== "done" && row.mode === "wizard") {
    throw new ProductionInputError("Finish pre-production before starting production.");
  }
}

/** The lineage's stage, from its current block and latest live take. */
export async function lineageStage(
  db: DbExecutor,
  block: PromptBlock,
): Promise<{ stage: BlockProductionStage; take: TakeRow | null }> {
  const take = await latestLiveTake(db, block.lineageId);
  return { stage: deriveBlockStage(block, take), take };
}

export function reviewReason(
  decision: "accepted" | "rejected",
  issueCodes: readonly string[] | undefined,
  note: string | undefined,
): { issueCodes: string[]; note: string | null } {
  const codes = [...new Set(issueCodes ?? [])];
  const text = note ? note : null;
  if (decision === "rejected" && codes.length === 0 && !text) {
    throw new ProductionInputError(NEEDS_REASON);
  }
  return { issueCodes: decision === "rejected" ? codes : [], note: text };
}
