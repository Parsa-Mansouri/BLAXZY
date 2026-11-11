/**
 * Shared internals of Production around `block_take` (owned by this module): row types, the take
 * view the screens get, and the queries for a lineage's latest live take. Not exported from the
 * module index.
 */
import { and, desc, eq, inArray, isNotNull, ne, notInArray } from "drizzle-orm";
import { SAMPLE_MODEL } from "@/server/damis";
import type { DbExecutor, DbTx } from "@/server/db/client";
import {
  blockTake,
  damiRun,
  generation,
  projectEvent,
  type LookStatus,
  type TakeStage,
} from "@/server/db/schema";
import { isSampleProvider } from "@/server/providers";

export type TakeRow = typeof blockTake.$inferSelect;

export type TakeView = {
  id: string;
  takeNumber: number;
  stage: TakeStage;
  status: LookStatus;
  /** The clip, once generated. */
  fileId: string | null;
  /** A still of the clip. */
  posterFileId: string | null;
  /** User-readable reason when failed. */
  failure: string | null;
  /** Placeholder output (sample provider) or a prompt written in sample mode. */
  isSample: boolean;
  /** Credits reserved for its generation; null before it was requested. */
  priceCredits: number | null;
  createdAt: Date;
  decidedAt: Date | null;
};

/** Takes listed in a block's detail, newest first. */
export const MAX_LISTED_TAKES = 20;

/** A take that still counts (every status but superseded). */
const LIVE_STATUSES: LookStatus[] = ["pending", "in_review", "accepted", "rejected", "failed"];

export function toTakeView(
  row: TakeRow,
  joined: { provider: string | null; model: string | null; priceCredits: number | null },
): TakeView {
  return {
    id: row.id,
    takeNumber: row.takeNumber,
    stage: row.stage,
    status: row.status,
    fileId: row.fileId,
    posterFileId: row.posterFileId,
    failure: row.failure,
    isSample:
      (joined.provider !== null && isSampleProvider(joined.provider)) ||
      joined.model === SAMPLE_MODEL,
    priceCredits: joined.priceCredits,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

/** The newest takes of a lineage, newest first, with what the view needs. */
export async function listTakeViews(
  db: DbExecutor,
  lineageId: string,
  limit = MAX_LISTED_TAKES,
): Promise<TakeView[]> {
  const rows = await db
    .select({
      take: blockTake,
      provider: generation.provider,
      priceCredits: generation.priceCredits,
      model: damiRun.model,
    })
    .from(blockTake)
    .leftJoin(generation, eq(generation.id, blockTake.generationId))
    .leftJoin(damiRun, eq(damiRun.id, blockTake.damiRunId))
    .where(eq(blockTake.lineageId, lineageId))
    .orderBy(desc(blockTake.takeNumber))
    .limit(limit);
  return rows.map((r) => toTakeView(r.take, r));
}

/** The newest live take of each lineage (of one project), keyed by lineage. */
export async function latestLiveTakes(
  db: DbExecutor,
  projectId: string,
  lineageIds?: readonly string[],
): Promise<Map<string, TakeRow>> {
  if (lineageIds && lineageIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([blockTake.lineageId])
    .from(blockTake)
    .where(
      and(
        eq(blockTake.projectId, projectId),
        inArray(blockTake.status, LIVE_STATUSES),
        lineageIds ? inArray(blockTake.lineageId, [...lineageIds]) : undefined,
      ),
    )
    .orderBy(blockTake.lineageId, desc(blockTake.takeNumber));
  return new Map(rows.map((r) => [r.lineageId, r]));
}

export async function latestLiveTake(db: DbExecutor, lineageId: string): Promise<TakeRow | null> {
  const [row] = await db
    .select()
    .from(blockTake)
    .where(and(eq(blockTake.lineageId, lineageId), ne(blockTake.status, "superseded")))
    .orderBy(desc(blockTake.takeNumber))
    .limit(1);
  return row ?? null;
}

/** The newest live take with a poster of each lineage (the block's thumbnail). */
export async function newestPosters(
  db: DbExecutor,
  projectId: string,
  lineageIds: readonly string[],
): Promise<Map<string, string>> {
  if (lineageIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([blockTake.lineageId], {
      lineageId: blockTake.lineageId,
      posterFileId: blockTake.posterFileId,
    })
    .from(blockTake)
    .where(
      and(
        eq(blockTake.projectId, projectId),
        inArray(blockTake.lineageId, [...lineageIds]),
        ne(blockTake.status, "superseded"),
        isNotNull(blockTake.posterFileId),
      ),
    )
    .orderBy(blockTake.lineageId, desc(blockTake.takeNumber));
  const map = new Map<string, string>();
  for (const r of rows) if (r.posterFileId) map.set(r.lineageId, r.posterFileId);
  return map;
}

export async function getTake(db: DbExecutor, takeId: string): Promise<TakeRow | null> {
  const [row] = await db.select().from(blockTake).where(eq(blockTake.id, takeId)).limit(1);
  return row ?? null;
}

/** Inserts a take with the lineage's next number (the caller holds the lineage's block lock). */
export async function insertTake(
  tx: DbTx,
  values: Omit<typeof blockTake.$inferInsert, "takeNumber">,
): Promise<TakeRow> {
  const [last] = await tx
    .select({ n: blockTake.takeNumber })
    .from(blockTake)
    .where(eq(blockTake.lineageId, values.lineageId))
    .orderBy(desc(blockTake.takeNumber))
    .limit(1);
  const [row] = await tx
    .insert(blockTake)
    .values({ ...values, takeNumber: (last?.n ?? 0) + 1 })
    .returning();
  if (!row) throw new Error("block_take insert returned no row");
  return row;
}

/**
 * Supersedes the live takes of lineages whose block changed (the block is prepared again): every
 * take still pending, in review, failed or accepted. Rejected takes stay as they were decided.
 */
export async function supersedeLineageTakes(
  tx: DbTx,
  projectId: string,
  lineageIds: readonly string[],
): Promise<number> {
  if (lineageIds.length === 0) return 0;
  const rows = await tx
    .update(blockTake)
    .set({ status: "superseded" })
    .where(
      and(
        eq(blockTake.projectId, projectId),
        inArray(blockTake.lineageId, [...lineageIds]),
        inArray(blockTake.status, ["pending", "in_review", "failed", "accepted"]),
      ),
    )
    .returning({ id: blockTake.id });
  return rows.length;
}

/**
 * Supersedes the unfinished takes (pending, in review, failed) of lineages that are no longer in
 * the film (the script dropped their block). Their accepted clips stay, as history.
 */
export async function supersedeDroppedLineageTakes(
  tx: DbTx,
  projectId: string,
  currentLineageIds: readonly string[],
): Promise<number> {
  const rows = await tx
    .update(blockTake)
    .set({ status: "superseded" })
    .where(
      and(
        eq(blockTake.projectId, projectId),
        inArray(blockTake.status, ["pending", "in_review", "failed"]),
        currentLineageIds.length > 0
          ? notInArray(blockTake.lineageId, [...currentLineageIds])
          : undefined,
      ),
    )
    .returning({ id: blockTake.id });
  return rows.length;
}

export async function logEvent(
  db: DbExecutor,
  projectId: string,
  userId: string | null,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(projectEvent).values({ projectId, userId, type, payload });
}
