/**
 * The Production stage's access to `prompt_block` (this module owns the table): the current blocks
 * with their production fields, the next version of a block, and the preparation lifecycle
 * (`productionState` none → pending → ready | failed). Used by `@/server/production` and its job
 * handlers; every function that changes rows takes the caller's transaction when it must be
 * atomic with other writes. Nothing here checks ownership: callers do.
 */
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, type DbExecutor, type DbTx } from "@/server/db/client";
import { promptBlock } from "@/server/db/schema";
import type { PromptBlock } from "./common";

const current = isNull(promptBlock.supersededAt);

/** The most blocks one project's production reads at once (a 4-hour film of 5 s blocks fits). */
export const MAX_PRODUCTION_BLOCKS = 5_000;

/** What deriving a block's production stage needs, for every current block of a project. */
export type BlockStateRow = Pick<
  PromptBlock,
  | "id"
  | "lineageId"
  | "orderIndex"
  | "episodeId"
  | "stale"
  | "productionState"
  | "approvedAt"
  | "productionAssetRefs"
>;

/** The project's current blocks (state columns only), in story order. */
export async function listCurrentBlockStates(
  projectId: string,
  db: DbExecutor = getDb(),
): Promise<BlockStateRow[]> {
  return db
    .select({
      id: promptBlock.id,
      lineageId: promptBlock.lineageId,
      orderIndex: promptBlock.orderIndex,
      episodeId: promptBlock.episodeId,
      stale: promptBlock.stale,
      productionState: promptBlock.productionState,
      approvedAt: promptBlock.approvedAt,
      productionAssetRefs: promptBlock.productionAssetRefs,
    })
    .from(promptBlock)
    .where(and(eq(promptBlock.projectId, projectId), current))
    .orderBy(asc(promptBlock.orderIndex), asc(promptBlock.id))
    .limit(MAX_PRODUCTION_BLOCKS);
}

/**
 * One keyset page of the project's current blocks in story order (`after` is the last row of the
 * previous page). `lineageIds` narrows the page to those lineages.
 */
export async function pageCurrentBlocks(
  projectId: string,
  opts: { limit: number; after?: { orderIndex: number; id: string } | null; lineageIds?: string[] },
  db: DbExecutor = getDb(),
): Promise<PromptBlock[]> {
  if (opts.lineageIds && opts.lineageIds.length === 0) return [];
  const after = opts.after;
  return db
    .select()
    .from(promptBlock)
    .where(
      and(
        eq(promptBlock.projectId, projectId),
        current,
        opts.lineageIds ? inArray(promptBlock.lineageId, opts.lineageIds) : undefined,
        after
          ? sql`(${promptBlock.orderIndex}, ${promptBlock.id}) > (${after.orderIndex}, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(promptBlock.orderIndex), asc(promptBlock.id))
    .limit(opts.limit);
}

/** The current version of a lineage (row-locked with `lock`, inside the caller's transaction). */
export async function getCurrentBlock(
  lineageId: string,
  db: DbExecutor = getDb(),
  lock = false,
): Promise<PromptBlock | null> {
  const query = db
    .select()
    .from(promptBlock)
    .where(and(eq(promptBlock.lineageId, lineageId), current))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

/** Current versions of several lineages. */
export async function getCurrentBlocks(
  lineageIds: string[],
  db: DbExecutor = getDb(),
): Promise<PromptBlock[]> {
  if (lineageIds.length === 0) return [];
  return db
    .select()
    .from(promptBlock)
    .where(and(inArray(promptBlock.lineageId, lineageIds), current));
}

/** One block version, current or not. */
export async function getBlockVersion(
  blockId: string,
  db: DbExecutor = getDb(),
): Promise<PromptBlock | null> {
  const [row] = await db.select().from(promptBlock).where(eq(promptBlock.id, blockId)).limit(1);
  return row ?? null;
}

/** The version before this one in its lineage (null for the first). */
export async function getPreviousVersion(
  block: Pick<PromptBlock, "lineageId" | "versionNumber">,
  db: DbExecutor = getDb(),
): Promise<PromptBlock | null> {
  const [row] = await db
    .select()
    .from(promptBlock)
    .where(
      and(
        eq(promptBlock.lineageId, block.lineageId),
        lt(promptBlock.versionNumber, block.versionNumber),
      ),
    )
    .orderBy(desc(promptBlock.versionNumber))
    .limit(1);
  return row ?? null;
}

/** The current block right before this one in the film (same project and episode), if any. */
export async function getPreviousCurrentBlock(
  block: Pick<PromptBlock, "projectId" | "episodeId" | "orderIndex" | "id">,
  db: DbExecutor = getDb(),
): Promise<PromptBlock | null> {
  const [row] = await db
    .select()
    .from(promptBlock)
    .where(
      and(
        eq(promptBlock.projectId, block.projectId),
        block.episodeId === null
          ? isNull(promptBlock.episodeId)
          : eq(promptBlock.episodeId, block.episodeId),
        current,
        or(
          lt(promptBlock.orderIndex, block.orderIndex),
          and(eq(promptBlock.orderIndex, block.orderIndex), lt(promptBlock.id, block.id)),
        ),
      ),
    )
    .orderBy(desc(promptBlock.orderIndex), desc(promptBlock.id))
    .limit(1);
  return row ?? null;
}

/**
 * Of these block versions, the ones a script edit sent back through preparation: the version
 * before each was cut from another script version and had been in production, and this one does
 * not carry that preparation over. One indexed join on (lineage, version).
 */
export async function listScriptResetBlocks(
  blockIds: readonly string[],
  db: DbExecutor = getDb(),
): Promise<Set<string>> {
  if (blockIds.length === 0) return new Set();
  const before = alias(promptBlock, "before");
  const rows = await db
    .select({ id: promptBlock.id })
    .from(promptBlock)
    .innerJoin(
      before,
      and(
        eq(before.lineageId, promptBlock.lineageId),
        eq(before.versionNumber, sql`${promptBlock.versionNumber} - 1`),
      ),
    )
    .where(
      and(
        inArray(promptBlock.id, [...blockIds]),
        ne(before.scriptVersionId, promptBlock.scriptVersionId),
        ne(before.productionState, "none"),
        sql`${before.productionDamiRunId} is distinct from ${promptBlock.productionDamiRunId}`,
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * Moves the project's current, non-stale blocks that were never prepared (`none`) to `pending`
 * and returns them, so each gets exactly one preparation job even when called concurrently.
 */
export async function claimBlocksForPreparation(
  projectId: string,
  tx: DbTx,
): Promise<PromptBlock[]> {
  return tx
    .update(promptBlock)
    .set({ productionState: "pending", productionFailure: null })
    .where(
      and(
        eq(promptBlock.projectId, projectId),
        current,
        eq(promptBlock.stale, false),
        eq(promptBlock.productionState, "none"),
      ),
    )
    .returning();
}

/**
 * Supersedes the current version of a lineage (row already locked by the caller) and inserts the
 * next one: same script section, with `changes` applied and the production fields reset (the new
 * version is prepared again). Returns the new row.
 */
export async function createNextBlockVersion(
  currentRow: PromptBlock,
  changes: {
    assetRefs?: string[];
    productionState: "none" | "pending";
    /** A user's choice of references, kept on the version until preparation binds them. */
    productionAssetRefs?: string[] | null;
  },
  tx: DbTx,
): Promise<PromptBlock> {
  await tx
    .update(promptBlock)
    .set({ supersededAt: new Date() })
    .where(and(eq(promptBlock.id, currentRow.id), current));
  const [row] = await tx
    .insert(promptBlock)
    .values({
      lineageId: currentRow.lineageId,
      versionNumber: currentRow.versionNumber + 1,
      projectId: currentRow.projectId,
      episodeId: currentRow.episodeId,
      scriptVersionId: currentRow.scriptVersionId,
      orderIndex: currentRow.orderIndex,
      title: currentRow.title,
      scriptExcerpt: currentRow.scriptExcerpt,
      direction: currentRow.direction,
      prompt: currentRow.prompt,
      durationSeconds: currentRow.durationSeconds,
      assetRefs: changes.assetRefs ?? currentRow.assetRefs,
      stale: currentRow.stale,
      staleReason: currentRow.staleReason,
      damiRunId: currentRow.damiRunId,
      productionState: changes.productionState,
      productionAssetRefs: changes.productionAssetRefs ?? null,
    })
    .returning();
  if (!row) throw new Error("prompt_block insert returned no row");
  return row;
}

/** pending → ready with the preparation's output. False when the block is no longer pending. */
export async function storeBlockPreparation(
  input: {
    blockId: string;
    prompt: string;
    assetRefs: string[];
    notes: string[];
    damiRunId: string | null;
  },
  db: DbExecutor = getDb(),
): Promise<PromptBlock | null> {
  const [row] = await db
    .update(promptBlock)
    .set({
      productionState: "ready",
      productionPrompt: input.prompt,
      productionAssetRefs: input.assetRefs,
      productionNotes: input.notes,
      productionDamiRunId: input.damiRunId,
      productionFailure: null,
    })
    .where(and(eq(promptBlock.id, input.blockId), eq(promptBlock.productionState, "pending")))
    .returning();
  return row ?? null;
}

/** pending → failed with a user-readable reason. Null when the block is no longer pending. */
export async function failBlockPreparation(
  input: { blockId: string; failure: string; damiRunId?: string | null },
  db: DbExecutor = getDb(),
): Promise<PromptBlock | null> {
  const [row] = await db
    .update(promptBlock)
    .set({
      productionState: "failed",
      productionFailure: input.failure,
      ...(input.damiRunId ? { productionDamiRunId: input.damiRunId } : {}),
    })
    .where(and(eq(promptBlock.id, input.blockId), eq(promptBlock.productionState, "pending")))
    .returning();
  return row ?? null;
}

/** failed → pending (a retry). False when the block is not a current, failed one. */
export async function restartBlockPreparation(blockId: string, tx: DbTx): Promise<boolean> {
  const rows = await tx
    .update(promptBlock)
    .set({ productionState: "pending", productionFailure: null })
    .where(and(eq(promptBlock.id, blockId), current, eq(promptBlock.productionState, "failed")))
    .returning({ id: promptBlock.id });
  return rows.length > 0;
}

/**
 * Sets `approvedAt` on current, prepared, non-stale blocks that are not approved yet. Returns the
 * rows it approved.
 */
export async function approveBlocks(
  blockIds: string[],
  tx: DbTx,
): Promise<Pick<PromptBlock, "id" | "lineageId" | "productionDamiRunId">[]> {
  if (blockIds.length === 0) return [];
  return tx
    .update(promptBlock)
    .set({ approvedAt: new Date() })
    .where(
      and(
        inArray(promptBlock.id, blockIds),
        current,
        eq(promptBlock.stale, false),
        eq(promptBlock.productionState, "ready"),
        isNull(promptBlock.approvedAt),
      ),
    )
    .returning({
      id: promptBlock.id,
      lineageId: promptBlock.lineageId,
      productionDamiRunId: promptBlock.productionDamiRunId,
    });
}
