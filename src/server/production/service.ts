/**
 * Production (Output_04): every current block is prepared (text-blocks), reviewed and approved;
 * then each approved block gets a cheap draft take, an accepted draft is finished as a final take,
 * and the project is done when every block has an accepted final.
 *
 * Every function takes the acting user and returns null (or false) when the project or block is
 * missing, archived or not theirs; input the user can fix throws `ProductionInputError` with a
 * user-safe message. Damis and generations run in jobs, enqueued after the transaction that
 * created their row has committed. Nothing is overwritten or deleted: decisions change statuses,
 * new attempts are new takes, and a changed block is a new block version.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { describeAssetsById } from "@/server/assets";
import { getBalance } from "@/server/billing";
import {
  approveBlocks,
  claimBlocksForPreparation,
  createNextBlockVersion,
  failBlockPreparation,
  getCurrentBlocks,
  getPreviousVersion,
  listCurrentBlockStates,
  pageCurrentBlocks,
  restartBlockPreparation,
  type PromptBlock,
} from "@/server/blocks";
import {
  BLOCK_ISSUE_CODES,
  isVoiceRef,
  MAX_REFERENCE_IMAGES,
  TAKE_ISSUE_CODES,
} from "@/server/damis";
import { getDb, type DbExecutor, type DbTx } from "@/server/db/client";
import { blockTake, project, review, type ProjectStyle } from "@/server/db/schema";
import { MAX_REFERENCES, quoteGeneration } from "@/server/generation";
import { blockRevise, enqueue, productionPrepare, takeFix, takeGenerate } from "@/server/jobs";
import { advanceStage, reopenProduction } from "@/server/projects";
import {
  isUuid,
  lockLineage,
  openLineage,
  openProject,
  parse,
  STALE_MESSAGE,
  userIdSchema,
  type ProjectRow,
} from "./access";
import { ProductionInputError } from "./errors";
import {
  BLOCK_PRODUCTION_STAGES,
  canStartDraftsFrom,
  derivePhase,
  type BlockProductionStage,
  type ProductionPhase,
} from "./stage";
import {
  getTake,
  insertTake,
  latestLiveTake,
  listTakeViews,
  logEvent,
  supersedeDroppedLineageTakes,
  supersedeLineageTakes,
  type TakeRow,
  type TakeView,
} from "./takes";
import { busyOf, projectStages, stageOf, toProductionBlocks, type ProductionBlock } from "./views";

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
};

export type ProductionQuote = {
  /** Approved blocks without a take, and what their drafts cost together. */
  drafts: { count: number; credits: number };
  /** The price of one final, for information. */
  finalsEach: number;
  balance: number;
};

/** The most references one take may attach (the engine's limit and the video model's). */
export const MAX_BLOCK_ASSETS = Math.min(MAX_REFERENCES, MAX_REFERENCE_IMAGES);
export const MAX_REVIEW_NOTE_LENGTH = 2000;
export const DEFAULT_BLOCK_PAGE_SIZE = 50;
export const MAX_BLOCK_PAGE_SIZE = 200;

const ENQUEUE_FAILURE = "We could not start this step. Try again in a moment.";
const NEEDS_REASON = "Tell us what is wrong: pick an issue or write a note.";
const NOT_IN_REVIEW = "This is no longer waiting for review. Reload the page.";
const BUSY_MESSAGE = "This shot is still being worked on. Wait for it to finish, then try again.";
const PRICE_CHANGED = "The price changed. Check the new total, then confirm again.";

/** Why the film cannot be finished or downloaded whole yet (no "x of y" totals). */
export function notFinalMessage(notFinal: number): string {
  return notFinal === 1
    ? "Finish every shot first. 1 shot is not final yet."
    : `Finish every shot first. ${notFinal} shots are not final yet.`;
}

/* ------------------------------------------------------------------------------------------ */
/* Input schemas                                                                               */
/* ------------------------------------------------------------------------------------------ */

const projectInput = z.object({ projectId: z.string(), userId: userIdSchema });
const lineageInput = z.object({ lineageId: z.string(), userId: userIdSchema });
const takeInput = z.object({ takeId: z.string(), userId: userIdSchema });

const noteSchema = z
  .string()
  .trim()
  .max(MAX_REVIEW_NOTE_LENGTH, `Keep the note under ${MAX_REVIEW_NOTE_LENGTH} characters.`)
  .optional();

const blockReviewInput = lineageInput.extend({
  decision: z.enum(["accepted", "rejected"], { error: "Approve the shot or ask for changes." }),
  issueCodes: z
    .array(z.enum(BLOCK_ISSUE_CODES, { error: "Pick issues from the list." }))
    .max(BLOCK_ISSUE_CODES.length)
    .optional(),
  note: noteSchema,
});

const takeReviewInput = takeInput.extend({
  decision: z.enum(["accepted", "rejected"], { error: "Accept the clip or ask for changes." }),
  issueCodes: z
    .array(z.enum(TAKE_ISSUE_CODES, { error: "Pick issues from the list." }))
    .max(TAKE_ISSUE_CODES.length)
    .optional(),
  note: noteSchema,
});

const setAssetsInput = lineageInput.extend({
  assetIds: z
    .array(z.string(), { error: "Choose the assets of this shot." })
    .max(MAX_BLOCK_ASSETS, `A shot can use at most ${MAX_BLOCK_ASSETS} assets.`),
});

const startDraftsInput = projectInput.extend({
  expectedCredits: z
    .number({ error: "Confirm the price first." })
    .int("Confirm the price first.")
    .min(0, "Confirm the price first."),
});

const listInput = z.object({
  limit: z.number().int().min(1).max(MAX_BLOCK_PAGE_SIZE).default(DEFAULT_BLOCK_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
  stage: z
    .array(z.enum(BLOCK_PRODUCTION_STAGES, { error: "Unknown stage." }))
    .max(BLOCK_PRODUCTION_STAGES.length)
    .optional(),
});

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

function encodeCursor(orderIndex: number, id: string): string {
  return Buffer.from(`${orderIndex}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { orderIndex: number; id: string } {
  const [order, id, ...rest] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const orderIndex = Number(order);
  if (rest.length > 0 || !Number.isInteger(orderIndex) || !isUuid(id ?? "")) {
    throw new ProductionInputError("That page link is no longer valid. Reload the list.");
  }
  return { orderIndex, id: id as string };
}

function requireStyle(row: ProjectRow): ProjectStyle {
  if (!row.style) throw new ProductionInputError("Choose the project's style first.");
  return row.style;
}

/** Production's writes need the project in the production stage (or done, when revisiting). */
function assertWritable(row: ProjectRow): void {
  if (row.stage !== "production" && row.stage !== "done" && row.mode === "wizard") {
    throw new ProductionInputError("Finish pre-production before starting production.");
  }
}

/** The lineage's stage, from its current block and latest live take. */
async function lineageStage(
  db: DbExecutor,
  block: PromptBlock,
): Promise<{ stage: BlockProductionStage; take: TakeRow | null }> {
  const take = await latestLiveTake(db, block.lineageId);
  return { stage: stageOf(block, take), take };
}

/** True when this version answers the rejected review of its predecessor (`block.revise`). */
async function isRevision(db: DbExecutor, block: PromptBlock): Promise<boolean> {
  const previous = await getPreviousVersion(block, db);
  if (!previous) return false;
  const [row] = await db
    .select({ id: review.id })
    .from(review)
    .where(
      and(
        eq(review.subjectType, "prompt_block"),
        eq(review.subjectId, previous.id),
        eq(review.decision, "rejected"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function enqueuePreparation(block: PromptBlock, revision: boolean): Promise<void> {
  const job = revision ? blockRevise : productionPrepare;
  try {
    await enqueue(job, { blockId: block.id });
  } catch (error) {
    console.error(`[production] could not enqueue ${job.name} for ${block.id}:`, error);
    await failBlockPreparation({ blockId: block.id, failure: ENQUEUE_FAILURE });
  }
}

/** Fails a pending take whose job could not be queued, so the user can retry it. */
async function enqueueTakeJob(take: Pick<TakeRow, "id" | "prompt">): Promise<void> {
  const job = take.prompt ? takeGenerate : takeFix;
  try {
    await enqueue(job, { takeId: take.id });
  } catch (error) {
    console.error(`[production] could not enqueue ${job.name} for ${take.id}:`, error);
    await getDb()
      .update(blockTake)
      .set({ status: "failed", failure: ENQUEUE_FAILURE })
      .where(and(eq(blockTake.id, take.id), eq(blockTake.status, "pending")));
  }
}

async function blockView(db: DbExecutor, block: PromptBlock): Promise<ProductionBlock | null> {
  const [view] = await toProductionBlocks(db, block.projectId, [block]);
  return view ?? null;
}

function reviewReason(
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

/* ------------------------------------------------------------------------------------------ */
/* Preparation                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/**
 * A finished film whose shots are not all final any more (a script edit sent some back through
 * preparation) returns to production. Runs inside the caller's transaction with the project row
 * locked. Waits while blocks are stale: the shots are being cut again, and an edit that changes no
 * shot leaves the film finished. True when this call reopened it.
 */
async function reopenIfUnfinished(
  tx: DbTx,
  row: Pick<ProjectRow, "id" | "stage">,
  userId: string | null,
  reason: string,
): Promise<boolean> {
  if (row.stage !== "done") return false;
  const states = await listCurrentBlockStates(row.id, tx);
  if (states.length === 0 || states.some((b) => b.stale)) return false;
  const { blocks, counts } = await projectStages(tx, row.id);
  if (counts.done === blocks.length) return false;
  const reopened = await reopenProduction({ projectId: row.id, reason, userId }, tx);
  if (reopened) {
    await logEvent(tx, row.id, userId, "production.reopened", {
      reason,
      notFinal: blocks.length - counts.done,
    });
  }
  return reopened;
}

/**
 * Called after the script's shots were cut again (worker): a finished film whose shots changed is
 * in production again. Idempotent. True when this call reopened it.
 */
export async function reopenProductionAfterScriptEdit(projectId: string): Promise<boolean> {
  if (!isUuid(projectId)) return false;
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ id: project.id, stage: project.stage })
      .from(project)
      .where(eq(project.id, projectId))
      .for("update");
    if (!row) return false;
    return reopenIfUnfinished(tx, row, null, "script_changed");
  });
}

/**
 * Starts preparing every current block that was never prepared (`production.prepare`), called
 * whenever Production is entered, whatever the stage. A block that changed since its takes were
 * made (a script edit, an asset merge) is such a block: its lineage's live takes are superseded
 * first. Unfinished takes of blocks the script dropped are superseded too. A finished project
 * whose shots are not all final any more is reopened (it heals a film stranded by an earlier
 * edit). No-op when everything is prepared or pending, when the project is not the user's, or
 * while blocks are stale (they wait for new blocks). `reopened` is true when this call moved the
 * project from done back to production.
 */
export async function ensurePrepared(
  projectId: string,
  userId: string,
): Promise<{ reopened: boolean }> {
  const outcome = await getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned) return { blocks: [], reopened: false };
    assertWritable(owned);
    const blocks = await claimBlocksForPreparation(projectId, tx);
    const superseded = await supersedeLineageTakes(
      tx,
      projectId,
      blocks.map((b) => b.lineageId),
    );
    const current = await listCurrentBlockStates(projectId, tx);
    const dropped = await supersedeDroppedLineageTakes(
      tx,
      projectId,
      current.map((b) => b.lineageId),
    );
    if (blocks.length > 0 || dropped > 0) {
      await logEvent(tx, projectId, userId, "production.prepare_started", {
        blocks: blocks.length,
        takesSuperseded: superseded + dropped,
      });
    }
    const reopened = await reopenIfUnfinished(tx, owned, userId, "shots_not_final");
    return { blocks, reopened };
  });
  for (const block of outcome.blocks) await enqueuePreparation(block, false);
  return { reopened: outcome.reopened };
}

/** Runs a failed preparation (or revision) of the lineage's current block again. */
export async function retryPreparation(input: {
  lineageId: string;
  userId: string;
}): Promise<BlockProductionStage | null> {
  const { lineageId, userId } = parse(lineageInput, input);
  const outcome = await getDb().transaction(async (tx) => {
    const locked = await lockLineage(tx, lineageId, userId);
    if (!locked) return null;
    const { block, project } = locked;
    assertWritable(project);
    if (block.stale) throw new ProductionInputError(STALE_MESSAGE);
    if (block.productionState !== "failed" || !(await restartBlockPreparation(block.id, tx))) {
      throw new ProductionInputError("Only a preparation that failed can be tried again.");
    }
    await logEvent(tx, project.id, userId, "production.preparation_retried", {
      lineageId,
      blockId: block.id,
    });
    return { block, revision: await isRevision(tx, block) };
  });
  if (!outcome) return null;
  await enqueuePreparation(outcome.block, outcome.revision);
  return "preparing";
}

/* ------------------------------------------------------------------------------------------ */
/* Reading                                                                                     */
/* ------------------------------------------------------------------------------------------ */

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
 * One page of the current blocks in story order, each with its stage. With `stage`, only blocks
 * in those stages (the scan reads further pages until the page is full).
 */
export async function listProductionBlocks(
  projectId: string,
  userId: string,
  opts: { limit?: number; cursor?: string | null; stage?: BlockProductionStage[] } = {},
): Promise<{ items: ProductionBlock[]; nextCursor: string | null } | null> {
  const { limit, cursor, stage } = parse(listInput, opts);
  const db = getDb();
  if (!(await openProject(db, projectId, userId))) return null;
  const wanted = stage ? new Set(stage) : null;
  let after = cursor ? decodeCursor(cursor) : null;
  const items: ProductionBlock[] = [];
  let more = false;
  const batch = wanted ? Math.max(limit + 1, 100) : limit + 1;
  for (;;) {
    const rows = await pageCurrentBlocks(projectId, { limit: batch, after }, db);
    const views = await toProductionBlocks(db, projectId, rows);
    for (const view of views) {
      if (wanted && !wanted.has(view.stage)) continue;
      if (items.length === limit) {
        more = true;
        break;
      }
      items.push(view);
    }
    const last = rows.at(-1);
    if (more || rows.length < batch || !last) break;
    after = { orderIndex: last.orderIndex, id: last.id };
  }
  const last = items.at(-1);
  return { items, nextCursor: more && last ? encodeCursor(last.orderIndex, last.id) : null };
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
  return {
    ...view,
    takes: await listTakeViews(db, lineageId),
    busy: busyOf(opened.block, take),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Block review                                                                                */
/* ------------------------------------------------------------------------------------------ */

const BEFORE_GENERATION: readonly BlockProductionStage[] = [
  "block_review",
  "approved",
  "prepare_failed",
];

/**
 * Sets the assets (references) of a block before generation: ready image assets of the project,
 * in the order given. Creates the block's next version holding the choice and prepares it again,
 * so the prompt's tokens match the new list. Returns the new version (preparing).
 */
export async function setBlockAssets(input: {
  lineageId: string;
  userId: string;
  assetIds: string[];
}): Promise<ProductionBlock | null> {
  const { lineageId, userId, assetIds } = parse(setAssetsInput, input);
  if (!isUuid(lineageId)) return null;
  const ids = [...new Set(assetIds)];
  if (!ids.every(isUuid)) throw new ProductionInputError("One of those assets was not found.");
  const created = await getDb().transaction(async (tx) => {
    const locked = await lockLineage(tx, lineageId, userId);
    if (!locked) return null;
    const { block, project } = locked;
    assertWritable(project);
    if (block.stale) throw new ProductionInputError(STALE_MESSAGE);
    const { stage } = await lineageStage(tx, block);
    if (stage === "preparing") throw new ProductionInputError(BUSY_MESSAGE);
    if (!BEFORE_GENERATION.includes(stage)) {
      throw new ProductionInputError(
        "The assets of a shot can only change before its clip is made.",
      );
    }
    const found = await describeAssetsById(project.id, ids, tx);
    const refs: string[] = [];
    for (const id of ids) {
      const asset = found.get(id);
      if (!asset) throw new ProductionInputError("One of those assets was not found.");
      if (asset.kind === "voice") {
        throw new ProductionInputError(
          `“${asset.name}” is a voice; voices are not attached as images.`,
        );
      }
      if (!asset.ready || !asset.referenceFileId) {
        throw new ProductionInputError(
          `“${asset.name}” is not ready yet. Finish it in Pre-production first.`,
        );
      }
      refs.push(asset.ref);
    }
    const voices = block.assetRefs.filter((r) => isVoiceRef(r));
    const next = await createNextBlockVersion(
      block,
      { assetRefs: [...refs, ...voices], productionState: "pending", productionAssetRefs: refs },
      tx,
    );
    await supersedeLineageTakes(tx, project.id, [lineageId]);
    await logEvent(tx, project.id, userId, "production.block_assets_set", {
      lineageId,
      blockId: next.id,
      previousBlockId: block.id,
      assetRefs: refs,
    });
    return next;
  });
  if (!created) return null;
  await enqueuePreparation(created, false);
  return blockView(getDb(), created);
}

/**
 * Approves a prepared block, or asks for changes (an issue or a note is needed): the block's next
 * version is revised from the review (`block.revise`). An approved block can still be sent back
 * before its draft is made. Reviews go to `review` with the dami run that prepared the prompt.
 */
export async function submitBlockReview(input: {
  lineageId: string;
  userId: string;
  decision: "accepted" | "rejected";
  issueCodes?: string[];
  note?: string;
}): Promise<BlockProductionStage | null> {
  const parsed = parse(blockReviewInput, input);
  const { lineageId, userId, decision } = parsed;
  if (!isUuid(lineageId)) return null;
  const reason = reviewReason(decision, parsed.issueCodes, parsed.note);
  const outcome = await getDb().transaction(async (tx) => {
    const locked = await lockLineage(tx, lineageId, userId);
    if (!locked) return null;
    const { block, project } = locked;
    assertWritable(project);
    if (block.stale) throw new ProductionInputError(STALE_MESSAGE);
    const { stage } = await lineageStage(tx, block);
    const allowed = stage === "block_review" || (decision === "rejected" && stage === "approved");
    if (!allowed) throw new ProductionInputError(NOT_IN_REVIEW);
    await tx.insert(review).values({
      projectId: project.id,
      userId,
      subjectType: "prompt_block",
      subjectId: block.id,
      decision,
      issueCodes: reason.issueCodes,
      note: reason.note,
      damiRunId: block.productionDamiRunId,
    });
    if (decision === "accepted") {
      await approveBlocks([block.id], tx);
      await logEvent(tx, project.id, userId, "production.block_approved", {
        lineageId,
        blockId: block.id,
      });
      return { stage: "approved" as const, next: null };
    }
    const next = await createNextBlockVersion(block, { productionState: "pending" }, tx);
    await logEvent(tx, project.id, userId, "production.block_rejected", {
      lineageId,
      blockId: block.id,
      nextBlockId: next.id,
      issueCodes: reason.issueCodes,
    });
    return { stage: "preparing" as const, next };
  });
  if (!outcome) return null;
  if (outcome.next) await enqueuePreparation(outcome.next, true);
  return outcome.stage;
}

/** Approves every block waiting in block review (one accepted review each). Returns how many. */
export async function approveAllBlocks(input: {
  projectId: string;
  userId: string;
}): Promise<number> {
  const { projectId, userId } = parse(projectInput, input);
  return getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned) return 0;
    assertWritable(owned);
    const { blocks } = await projectStages(tx, projectId);
    const waiting = blocks.filter((b) => b.stage === "block_review").map((b) => b.id);
    const approved = await approveBlocks(waiting, tx);
    if (approved.length === 0) return 0;
    await tx.insert(review).values(
      approved.map((b) => ({
        projectId,
        userId,
        subjectType: "prompt_block" as const,
        subjectId: b.id,
        decision: "accepted" as const,
        damiRunId: b.productionDamiRunId,
      })),
    );
    await logEvent(tx, projectId, userId, "production.blocks_approved", {
      count: approved.length,
      lineageIds: approved.map((b) => b.lineageId),
    });
    return approved.length;
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Drafts                                                                                      */
/* ------------------------------------------------------------------------------------------ */

async function draftQuote(
  db: DbExecutor,
  row: ProjectRow,
): Promise<{ lineageIds: string[]; each: number; finalsEach: number }> {
  const style = requireStyle(row);
  const { blocks } = await projectStages(db, row.id);
  const lineageIds = blocks.filter((b) => b.stage === "approved").map((b) => b.lineageId);
  const [draft, final] = await Promise.all([
    quoteGeneration({ purpose: "block_draft", style }),
    quoteGeneration({ purpose: "block_final", style }),
  ]);
  return { lineageIds, each: draft.priceCredits, finalsEach: final.priceCredits };
}

/** What starting the drafts costs: one draft per approved block without a take. */
export async function quoteProduction(
  projectId: string,
  userId: string,
): Promise<ProductionQuote | null> {
  const db = getDb();
  const owned = await openProject(db, projectId, userId);
  if (!owned) return null;
  const quote = await draftQuote(db, owned);
  return {
    drafts: { count: quote.lineageIds.length, credits: quote.lineageIds.length * quote.each },
    finalsEach: quote.finalsEach,
    balance: await getBalance(userId),
  };
}

/**
 * Starts one draft take per approved block without a take (`take.generate` each), after the user
 * confirmed the total. Refused when the total is not `expectedCredits` any more, when the balance
 * does not cover it, or while blocks are still being prepared or reviewed. Each draft still
 * reserves its own credits when it is requested (a draft that cannot fails with the credits
 * message).
 */
export async function startDrafts(input: {
  projectId: string;
  userId: string;
  expectedCredits: number;
}): Promise<{ started: number }> {
  const { projectId, userId, expectedCredits } = parse(startDraftsInput, input);
  const takes = await getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned) return null;
    if (owned.stage !== "production") {
      throw new ProductionInputError("This project is not in production.");
    }
    const { counts } = await projectStages(tx, projectId);
    if (counts.approved === 0) {
      throw new ProductionInputError("There are no approved shots waiting for a draft.");
    }
    if (!canStartDraftsFrom(counts)) {
      throw new ProductionInputError("Review every shot first, then start the drafts.");
    }
    const quote = await draftQuote(tx, owned);
    const total = quote.lineageIds.length * quote.each;
    if (total !== expectedCredits) throw new ProductionInputError(PRICE_CHANGED);
    const balance = await getBalance(userId);
    if (balance < total) {
      throw new ProductionInputError(
        `These drafts need ${total} credits and your balance is ${balance}. Add credits, then try again.`,
      );
    }
    const blocks = await getCurrentBlocks(quote.lineageIds, tx);
    blocks.sort((a, b) => a.orderIndex - b.orderIndex);
    const created: TakeRow[] = [];
    for (const block of blocks) {
      created.push(
        await insertTake(tx, {
          projectId,
          blockId: block.id,
          lineageId: block.lineageId,
          stage: "draft",
          status: "pending",
          prompt: block.productionPrompt,
          damiRunId: block.productionDamiRunId,
        }),
      );
    }
    await logEvent(tx, projectId, userId, "production.drafts_started", {
      count: created.length,
      credits: total,
      takeIds: created.map((t) => t.id),
    });
    return created;
  });
  if (!takes) throw new ProductionInputError("That project was not found.");
  for (const take of takes) await enqueueTakeJob(take);
  return { started: takes.length };
}

/* ------------------------------------------------------------------------------------------ */
/* Take review                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/**
 * Accepts or rejects the lineage's latest take in review, recording the review with the dami run
 * that wrote its prompt. Draft accepted: a final take is made from exactly that draft
 * (`take.generate`). Final accepted: the block is done. Rejected (an issue or a note is needed):
 * a new draft with a fixed prompt (`take.fix`).
 */
export async function submitTakeReview(input: {
  takeId: string;
  userId: string;
  decision: "accepted" | "rejected";
  issueCodes?: string[];
  note?: string;
}): Promise<BlockProductionStage | null> {
  const parsed = parse(takeReviewInput, input);
  const { takeId, userId, decision } = parsed;
  if (!isUuid(takeId)) return null;
  const reason = reviewReason(decision, parsed.issueCodes, parsed.note);
  const outcome = await getDb().transaction(async (tx) => {
    const target = await getTake(tx, takeId);
    if (!target) return null;
    const locked = await lockLineage(tx, target.lineageId, userId);
    if (!locked) return null;
    const { block, project } = locked;
    assertWritable(project);
    const latest = await latestLiveTake(tx, target.lineageId);
    if (!latest || latest.id !== takeId || latest.status !== "in_review") {
      throw new ProductionInputError(NOT_IN_REVIEW);
    }
    if (block.stale) throw new ProductionInputError(STALE_MESSAGE);
    const now = new Date();
    await tx.insert(review).values({
      projectId: project.id,
      userId,
      subjectType: "generation",
      subjectId: takeId,
      decision,
      issueCodes: reason.issueCodes,
      note: reason.note,
      damiRunId: latest.damiRunId,
    });
    await tx
      .update(blockTake)
      .set({ status: decision, decidedAt: now })
      .where(eq(blockTake.id, takeId));
    const event = {
      lineageId: block.lineageId,
      takeId,
      stage: latest.stage,
      issueCodes: reason.issueCodes,
    };
    if (decision === "accepted" && latest.stage === "final") {
      await logEvent(tx, project.id, userId, "production.take_accepted", event);
      return { stage: "done" as const, next: null };
    }
    if (decision === "accepted") {
      const final = await insertTake(tx, {
        projectId: project.id,
        blockId: latest.blockId,
        lineageId: latest.lineageId,
        stage: "final",
        status: "pending",
        draftTakeId: latest.id,
        prompt: latest.prompt,
        referenceFileIds: latest.referenceFileIds,
        damiRunId: latest.damiRunId,
      });
      await logEvent(tx, project.id, userId, "production.take_accepted", {
        ...event,
        finalTakeId: final.id,
      });
      return { stage: "final_generating" as const, next: final };
    }
    const next = await insertTake(tx, {
      projectId: project.id,
      blockId: block.id,
      lineageId: block.lineageId,
      stage: "draft",
      status: "pending",
      parentId: latest.id,
    });
    await logEvent(tx, project.id, userId, "production.take_rejected", {
      ...event,
      nextTakeId: next.id,
    });
    return { stage: "draft_generating" as const, next };
  });
  if (!outcome) return null;
  if (outcome.next) await enqueueTakeJob(outcome.next);
  return outcome.stage;
}

/**
 * Runs the lineage's latest take again after it failed: back to pending and its job re-enqueued.
 * The job re-runs the take-fixer only when no prompt was stored; the failed generation's credits
 * were refunded and are never reused.
 */
export async function retryTake(input: {
  takeId: string;
  userId: string;
}): Promise<BlockProductionStage | null> {
  const { takeId, userId } = parse(takeInput, input);
  if (!isUuid(takeId)) return null;
  const take = await getDb().transaction(async (tx) => {
    const target = await getTake(tx, takeId);
    if (!target) return null;
    const locked = await lockLineage(tx, target.lineageId, userId);
    if (!locked) return null;
    const { block, project } = locked;
    assertWritable(project);
    if (block.stale) throw new ProductionInputError(STALE_MESSAGE);
    const latest = await latestLiveTake(tx, target.lineageId);
    if (!latest || latest.id !== takeId || latest.status !== "failed") {
      throw new ProductionInputError("Only the latest clip that failed can be tried again.");
    }
    const [updated] = await tx
      .update(blockTake)
      .set({ status: "pending", failure: null, generationId: null })
      .where(and(eq(blockTake.id, takeId), eq(blockTake.status, "failed")))
      .returning();
    await logEvent(tx, project.id, userId, "production.take_retried", {
      lineageId: block.lineageId,
      takeId,
      stage: latest.stage,
    });
    return updated ?? null;
  });
  if (!take) return null;
  await enqueueTakeJob(take);
  return take.stage === "final" ? "final_generating" : "draft_generating";
}

/* ------------------------------------------------------------------------------------------ */
/* Completing the stage                                                                        */
/* ------------------------------------------------------------------------------------------ */

/**
 * Moves the project from production to done once every current block has an accepted final.
 * True when this call advanced it; false when the project is not the user's or not in production.
 * Throws `ProductionInputError` while blocks are not done.
 */
export async function completeProduction(input: {
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const { projectId, userId } = parse(projectInput, input);
  return getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned || owned.stage !== "production") return false;
    const { blocks, counts } = await projectStages(tx, projectId);
    if (blocks.length === 0) throw new ProductionInputError("There are no shots yet.");
    if (counts.done !== blocks.length) {
      throw new ProductionInputError(notFinalMessage(blocks.length - counts.done));
    }
    const advanced = await advanceStage({ projectId, from: "production", to: "done" }, tx);
    if (advanced) {
      await logEvent(tx, projectId, userId, "production.completed", { blocks: blocks.length });
    }
    return advanced;
  });
}
