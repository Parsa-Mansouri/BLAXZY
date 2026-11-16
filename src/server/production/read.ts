/** What the Production screens read: the overview, a page of blocks and one block's detail. */
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  getNextCurrentBlock,
  pageCurrentBlocks,
  parseBlockDirection,
  type BlockDirectionView,
  type PromptBlock,
  type RevisionView,
} from "@/server/blocks";
import { type DbExecutor, getDb } from "@/server/db/client";
import { blockTake, promptBlock } from "@/server/db/schema";
import { decodeOrderCursor, encodeOrderCursor } from "@/server/projects/cursor";
import { openLineage, openProject, parse } from "./access";
import { ProductionInputError } from "./errors";
import { listInput } from "./inputs";
import {
  type BlockProductionStage,
  canStartDraftsFrom,
  derivePhase,
  isBusy,
  type ProductionPhase,
} from "./stage";
import { latestLiveTake, listTakeViews, type TakeView } from "./takes";
import { type ProductionBlock, projectStages, toProductionBlocks } from "./views";

export type ProductionOverview = {
  /** The project's stage when read: Production is open in `production` and `done`. */
  projectStage: "production" | "done";
  phase: ProductionPhase;
  counts: Record<BlockProductionStage, number>;
  blockCount: number;
  canStartDrafts: boolean;
  canComplete: boolean;
};

export type BlockDetail = ProductionBlock & {
  /** Newest first, at most 20. */
  takes: TakeView[];
  /** A dami or a generation is working on the block; nothing new can be started. */
  busy: boolean;
  /** The Director's shot plan, staging and reasons; null for a block cut before the Director. */
  direction: BlockDirectionView | null;
  /** What the block's last revision reported; null for a version the Director wrote. */
  revision: BlockRevisionNotes | null;
};

/** The notes Block Revision left for the user, in plain fields. */
export type BlockRevisionNotes = {
  changeLog: string[];
  /** Requests it could not apply, in its own words. */
  notApplied: string[];
  splitRequired: boolean;
  /** `none` when it has nothing to suggest. */
  structuralSuggestion: string;
  /** The revision moved the shot's ending and the next shot has not been updated since. */
  nextNeedsUpdate: boolean;
};

function decodeCursor(cursor: string): { orderIndex: number; id: string } {
  const decoded = decodeOrderCursor(cursor);
  if (!decoded) {
    throw new ProductionInputError("That page link is no longer valid. Reload the list.");
  }
  return decoded;
}

export async function blockView(
  db: DbExecutor,
  block: PromptBlock,
): Promise<ProductionBlock | null> {
  const [view] = await toProductionBlocks(db, block.projectId, [block]);
  return view ?? null;
}

export async function getProductionOverview(
  projectId: string,
  userId: string,
): Promise<ProductionOverview | null> {
  const db = getDb();
  const owned = await openProject(db, projectId, userId);
  if (!owned) return null;
  const { blocks, counts } = await projectStages(db, projectId);
  return {
    projectStage: owned.stage === "done" ? "done" : "production",
    phase: derivePhase(counts),
    counts,
    blockCount: blocks.length,
    canStartDrafts: owned.stage === "production" && canStartDraftsFrom(counts),
    canComplete: owned.stage === "production" && blocks.length > 0 && counts.done === blocks.length,
  };
}

/**
 * The latest live take of each block's lineage (lateral, on the (lineage, take number) index)
 * and the block's stage computed from it in SQL: the same rules as `deriveBlockStage` (kept in
 * step by the integration test that compares the two).
 */
function stageSql(take: { status: SQL; stage: SQL }): SQL<string> {
  const final = sql`${take.stage} = 'final'`;
  return sql<string>`case
    when ${promptBlock.stale} then 'preparing'
    when ${promptBlock.productionState} in ('none', 'pending') then 'preparing'
    when ${promptBlock.productionState} = 'failed' then 'prepare_failed'
    when ${take.status} is null or ${take.status} = 'superseded' then
      case when ${promptBlock.approvedAt} is null then 'block_review' else 'approved' end
    when ${take.status} = 'pending' then
      case when ${final} then 'final_generating' else 'draft_generating' end
    when ${take.status} = 'in_review' then
      case when ${final} then 'final_review' else 'draft_review' end
    when ${take.status} = 'failed' then 'failed'
    when ${take.status} = 'accepted' then
      case when ${final} then 'done' else 'final_generating' end
    else 'draft_generating'
  end`;
}

/** One keyset page of the current blocks whose stage is one of `stages`, in story order. */
async function pageBlocksInStages(
  db: DbExecutor,
  projectId: string,
  stages: readonly BlockProductionStage[],
  opts: { limit: number; after: { orderIndex: number; id: string } | null },
): Promise<PromptBlock[]> {
  const latest = db
    .select({ status: blockTake.status, stage: blockTake.stage })
    .from(blockTake)
    .where(eq(blockTake.lineageId, promptBlock.lineageId))
    .orderBy(desc(blockTake.takeNumber))
    .limit(1)
    .as("latest_take");
  const { after } = opts;
  const rows = await db
    .select({ block: promptBlock })
    .from(promptBlock)
    .leftJoinLateral(latest, sql`true`)
    .where(
      and(
        eq(promptBlock.projectId, projectId),
        isNull(promptBlock.supersededAt),
        inArray(stageSql({ status: sql`${latest.status}`, stage: sql`${latest.stage}` }), [
          ...stages,
        ]),
        after
          ? sql`(${promptBlock.orderIndex}, ${promptBlock.id}) > (${after.orderIndex}, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(promptBlock.orderIndex), asc(promptBlock.id))
    .limit(opts.limit);
  return rows.map((r) => r.block);
}

/**
 * One page of the current blocks in story order, each with its stage. With `stage`, only blocks
 * in those stages: the filter runs in the database (one query per page, however few blocks
 * match).
 */
export async function listProductionBlocks(
  projectId: string,
  userId: string,
  opts: { limit?: number; cursor?: string | null; stage?: BlockProductionStage[] } = {},
): Promise<{ items: ProductionBlock[]; nextCursor: string | null } | null> {
  const { limit, cursor, stage } = parse(listInput, opts);
  const db = getDb();
  if (!(await openProject(db, projectId, userId))) return null;
  const after = cursor ? decodeCursor(cursor) : null;
  const rows =
    stage === undefined
      ? await pageCurrentBlocks(projectId, { limit: limit + 1, after }, db)
      : stage.length === 0
        ? []
        : await pageBlocksInStages(db, projectId, stage, { limit: limit + 1, after });
  const page = rows.slice(0, limit);
  const views = await toProductionBlocks(db, projectId, page);
  // The views derive the stage again (from the same rows); a block whose stage moved between
  // the two reads is left out of this page rather than shown under the wrong filter.
  const wanted = stage ? new Set(stage) : null;
  const items = wanted ? views.filter((v) => wanted.has(v.stage)) : views;
  const last = page.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeOrderCursor(last.orderIndex, last.id) : null,
  };
}

async function revisionNotes(
  db: DbExecutor,
  block: PromptBlock,
  revision: RevisionView,
): Promise<BlockRevisionNotes> {
  const { flags } = revision;
  let nextNeedsUpdate = false;
  if (flags.next_block_needs_update) {
    // Updated since = the next shot has a version newer than this revision.
    const next = await getNextCurrentBlock(block, db);
    nextNeedsUpdate = next !== null && !next.stale && next.createdAt <= block.createdAt;
  }
  return {
    changeLog: revision.change_log,
    notApplied: flags.not_applied,
    splitRequired: flags.split_required,
    structuralSuggestion: flags.structural_suggestion,
    nextNeedsUpdate,
  };
}

/** One block (by lineage) with its newest takes. */
export async function getBlockDetail(
  lineageId: string,
  userId: string,
): Promise<BlockDetail | null> {
  const db = getDb();
  const opened = await openLineage(db, lineageId, userId);
  if (!opened) return null;
  const take = await latestLiveTake(db, lineageId);
  const view = await blockView(db, opened.block);
  if (!view) return null;
  const direction = parseBlockDirection(opened.block.direction);
  return {
    ...view,
    takes: await listTakeViews(db, lineageId),
    busy: isBusy(opened.block, take),
    direction,
    revision: direction?.revision
      ? await revisionNotes(db, opened.block, direction.revision)
      : null,
  };
}

/** One Production section's status in the film navigator. */
export type ProductionSectionStatus = { toReview: number; rendering: number; failed: number };

export type ProductionNavigatorStatuses = {
  shots: ProductionSectionStatus;
  clips: ProductionSectionStatus;
  /** Some shot has an accepted final: the finished film can be watched. */
  finished: boolean;
};

/**
 * The navigator's Shots, Clips and Finished statuses from the per-stage counts. Pure. Shots:
 * shots to review, being prepared, whose preparation failed. Clips: drafts and finals to review,
 * being rendered, failed.
 */
export function productionNavigatorStatuses(
  counts: Record<BlockProductionStage, number>,
): ProductionNavigatorStatuses {
  return {
    shots: {
      toReview: counts.block_review,
      rendering: counts.preparing,
      failed: counts.prepare_failed,
    },
    clips: {
      toReview: counts.draft_review + counts.final_review,
      rendering: counts.draft_generating + counts.final_generating,
      failed: counts.failed,
    },
    finished: counts.done > 0,
  };
}

/** Stages in which a dami or a generation works on a shot. */
export const BUSY_BLOCK_STAGES: readonly BlockProductionStage[] = [
  "preparing",
  "draft_generating",
  "final_generating",
];

/** How many busy shots the navigator names. */
export const DEFAULT_BUSY_BLOCK_LIMIT = 5;
const MAX_BUSY_BLOCK_LIMIT = 20;

const busyLimit = (limit: number) =>
  Math.min(MAX_BUSY_BLOCK_LIMIT, Math.max(1, Math.trunc(limit) || 1));

/** A shot being prepared or rendered, as the navigator names it. */
export type BusyBlock = {
  lineageId: string;
  orderIndex: number;
  /** The block's title; screens fall back to "Shot <orderIndex + 1>". */
  title: string | null;
  stage: BlockProductionStage;
};

async function busyBlocks(db: DbExecutor, projectId: string, limit: number): Promise<BusyBlock[]> {
  const rows = await pageBlocksInStages(db, projectId, BUSY_BLOCK_STAGES, { limit, after: null });
  const views = await toProductionBlocks(db, projectId, rows);
  // The views derive the stage again; a shot that settled between the two reads is left out.
  return views
    .filter((v) => BUSY_BLOCK_STAGES.includes(v.stage))
    .map((v) => ({
      lineageId: v.lineageId,
      orderIndex: v.orderIndex,
      title: v.title,
      stage: v.stage,
    }));
}

/**
 * The first shots (in story order) being prepared or rendered, at most `limit` (one keyset page,
 * on the same query as the stage filter of `listProductionBlocks`). Null when the project is not
 * the user's.
 */
export async function listBusyBlocks(
  projectId: string,
  userId: string,
  limit = DEFAULT_BUSY_BLOCK_LIMIT,
): Promise<BusyBlock[] | null> {
  const db = getDb();
  if (!(await openProject(db, projectId, userId))) return null;
  return busyBlocks(db, projectId, busyLimit(limit));
}

export type ProductionNavigator = ProductionNavigatorStatuses & {
  /** The first busy shots, in story order. */
  busy: BusyBlock[];
  /** Busy shots beyond `busy`. */
  moreBusy: number;
};

/**
 * Everything the film navigator shows of Production: the section statuses and the first busy
 * shots. Reads the stages of every current block (as the overview) and, when some are busy, one
 * page of them. Null when the project is not the user's.
 */
export async function getProductionNavigator(
  projectId: string,
  userId: string,
  limit = DEFAULT_BUSY_BLOCK_LIMIT,
): Promise<ProductionNavigator | null> {
  const db = getDb();
  if (!(await openProject(db, projectId, userId))) return null;
  const { counts } = await projectStages(db, projectId);
  const busyCount = BUSY_BLOCK_STAGES.reduce((sum, stage) => sum + counts[stage], 0);
  const busy = busyCount > 0 ? await busyBlocks(db, projectId, busyLimit(limit)) : [];
  return {
    ...productionNavigatorStatuses(counts),
    busy,
    moreBusy: Math.max(0, busyCount - busy.length),
  };
}
