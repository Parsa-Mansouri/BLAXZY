/**
 * Shared internals of Production around `block_take` (owned by this module): row types, the take
 * view the screens get, and the queries for a lineage's latest live take. Not exported from the
 * module index.
 */
import { and, desc, eq, inArray, isNotNull, max, ne, notInArray } from "drizzle-orm";
import { isSampleOutput } from "@/server/assets";
import type { DbExecutor, DbTx } from "@/server/db/client";
import {
  blockTake,
  damiRun,
  generation,
  type LookStatus,
  type TakeStage,
} from "@/server/db/schema";

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
    isSample: isSampleOutput(joined.provider, joined.model),
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

/**
 * The newest live take of each lineage (of one project), keyed by lineage. A lineage whose newest
 * take is superseded has none: its block changed and was prepared again, and the takes before
 * (a rejected draft keeps its status as decided) belong to the old version.
 */
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
        lineageIds ? inArray(blockTake.lineageId, [...lineageIds]) : undefined,
      ),
    )
    .orderBy(blockTake.lineageId, desc(blockTake.takeNumber));
  return new Map(rows.filter((r) => LIVE_STATUSES.includes(r.status)).map((r) => [r.lineageId, r]));
}

/** The lineage's newest take unless it is superseded (see `latestLiveTakes`). */
export async function latestLiveTake(db: DbExecutor, lineageId: string): Promise<TakeRow | null> {
  const [row] = await db
    .select()
    .from(blockTake)
    .where(eq(blockTake.lineageId, lineageId))
    .orderBy(desc(blockTake.takeNumber))
    .limit(1);
  return row && LIVE_STATUSES.includes(row.status) ? row : null;
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

/** Rows inserted per statement by `insertDraftTakes` (well under Postgres' parameter limit). */
const INSERT_CHUNK = 500;

/**
 * Inserts one take per lineage (at most one value per lineage), each with its lineage's next
 * number: one query for every lineage's last number, then one insert per chunk. The caller holds
 * the project lock (which every take insert of the project takes first). Rows come back in the
 * order given.
 */
export async function insertDraftTakes(
  tx: DbTx,
  projectId: string,
  values: readonly Omit<typeof blockTake.$inferInsert, "takeNumber">[],
): Promise<TakeRow[]> {
  if (values.length === 0) return [];
  const lineageIds = [...new Set(values.map((v) => v.lineageId))];
  if (lineageIds.length !== values.length)
    throw new Error("insertDraftTakes: one take per lineage");
  const last = await tx
    .select({ lineageId: blockTake.lineageId, n: max(blockTake.takeNumber) })
    .from(blockTake)
    .where(and(eq(blockTake.projectId, projectId), inArray(blockTake.lineageId, lineageIds)))
    .groupBy(blockTake.lineageId);
  const next = new Map(last.map((r) => [r.lineageId, (r.n ?? 0) + 1]));
  const rows: TakeRow[] = [];
  for (let i = 0; i < values.length; i += INSERT_CHUNK) {
    const chunk = values
      .slice(i, i + INSERT_CHUNK)
      .map((v) => ({ ...v, takeNumber: next.get(v.lineageId) ?? 1 }));
    rows.push(...(await tx.insert(blockTake).values(chunk).returning()));
  }
  const byLineage = new Map(rows.map((r) => [r.lineageId, r]));
  return values.map((v) => {
    const row = byLineage.get(v.lineageId);
    if (!row) throw new Error("block_take insert returned no row");
    return row;
  });
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
