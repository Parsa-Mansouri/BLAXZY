/**
 * Updating a shot after the shot before it changed how it ends: a revision with a system note
 * (the previous shot's new ending), whatever state the shot is in. Two ways in:
 *
 * - `updateShotForHandoff`: from the shot's own notice ("The shot before now ends differently.",
 *   set when the previous shot was accepted, see `accept-effects.ts`);
 * - `requestNextShotUpdate`: from the revised shot's "Update the Next Shot" (Block Revision said
 *   the ending moved).
 *
 * A shot with clips gets a new draft once its revised version is prepared (`revision-draft.ts`),
 * which is paid: the price of one draft must be confirmed (`expectedCredits`) and is stored on the
 * review row that carries the request, exactly as when a clip is rejected. The shot's live takes
 * are superseded (they belong to the old version). A shot without clips is simply revised.
 */
import {
  getCurrentBlock,
  getNextCurrentBlock,
  getPreviousCurrentBlock,
  parseBlockDirection,
  type PromptBlock,
} from "@/server/blocks";
import { getBalance } from "@/server/billing";
import { type DbTx, getDb } from "@/server/db/client";
import { review } from "@/server/db/schema";
import { quoteSpend, type SpendQuote } from "@/server/generation";
import {
  assertWritable,
  isUuid,
  lineageStage,
  lockLineage,
  openLineage,
  parse,
  requireStyle,
  STALE_MESSAGE,
  type ProjectRow,
} from "./access";
import { ProductionInputError } from "./errors";
import { lineageInput } from "./inputs";
import { BUSY_MESSAGE } from "./messages";
import {
  ASSETS_ONLY_REQUEST,
  directedBlockOf,
  handOffNote,
  NOT_DIRECTED_MESSAGE,
  requestBlockRevision,
} from "./revision";
import type { RevisionRequest } from "./revision-request";
import { confirmTakeSpend } from "./spend";
import { latestLiveTake, supersedeLineageTakes } from "./takes";
import { z } from "zod";
import { userIdSchema } from "./access";

/** Revises `next` (its lineage's current version) to open from the end of `previous`. */
async function reviseFromHandoff(
  tx: DbTx,
  input: {
    project: ProjectRow;
    userId: string;
    previous: PromptBlock;
    next: PromptBlock;
    expectedCredits: number | undefined;
  },
): Promise<string> {
  const { project, userId, previous, next } = input;
  const before = directedBlockOf(previous);
  if (!before || !directedBlockOf(next)) throw new ProductionInputError(NOT_DIRECTED_MESSAGE);
  const locked = await getCurrentBlock(next.lineageId, tx, true);
  if (!locked || locked.id !== next.id) {
    throw new ProductionInputError("This shot changed meanwhile. Reload it and try again.");
  }
  if (locked.stale) throw new ProductionInputError(STALE_MESSAGE);
  const { stage, take } = await lineageStage(tx, locked);
  if (stage === "preparing" || take?.status === "pending") {
    throw new ProductionInputError(BUSY_MESSAGE);
  }
  const note = handOffNote(before, previous.title ?? `Shot ${previous.orderIndex + 1}`);
  if (!take) {
    // No clip yet: an ordinary revision of the shot, no credits.
    const request: RevisionRequest = { ...ASSETS_ONLY_REQUEST, note };
    const [row] = await tx
      .insert(review)
      .values({
        projectId: project.id,
        userId,
        subjectType: "prompt_block",
        subjectId: locked.id,
        decision: "rejected",
        note,
        revisionRequest: request,
        damiRunId: locked.productionDamiRunId,
      })
      .returning({ id: review.id });
    if (!row) throw new Error("review insert returned no row");
    await requestBlockRevision({ tx, blockId: locked.id, userId, reviewId: row.id });
    return locked.lineageId;
  }
  // A shot with clips gets a new draft when its revised version is prepared: confirm its price.
  const confirmedCredits = await confirmTakeSpend(
    tx,
    project,
    userId,
    "draft",
    input.expectedCredits,
  );
  const request: RevisionRequest = {
    ...ASSETS_ONLY_REQUEST,
    source: "take_review",
    note,
    takeId: take.id,
  };
  const [row] = await tx
    .insert(review)
    .values({
      projectId: project.id,
      userId,
      subjectType: "generation",
      subjectId: take.id,
      decision: "rejected",
      note,
      revisionRequest: request,
      confirmedCredits,
      damiRunId: take.damiRunId,
    })
    .returning({ id: review.id });
  if (!row) throw new Error("review insert returned no row");
  await requestBlockRevision({ tx, blockId: locked.id, userId, reviewId: row.id });
  await supersedeLineageTakes(tx, project.id, [locked.lineageId]);
  return locked.lineageId;
}

/**
 * Updates a shot that carries the hand-off notice so it opens from the new ending of the shot
 * before it. Works in any state of the shot (shot review, approved, with drafts or finals, done).
 * `expectedCredits` is the price of one draft, needed when the shot has clips. Returns the shot's
 * lineage id, or null when it is not the user's.
 */
export async function updateShotForHandoff(input: {
  lineageId: string;
  userId: string;
  expectedCredits?: number;
}): Promise<string | null> {
  const { lineageId, userId } = parse(lineageInput, input);
  if (!isUuid(lineageId)) return null;
  return getDb().transaction(async (tx) => {
    const locked = await lockLineage(tx, lineageId, userId);
    if (!locked) return null;
    const { block, project } = locked;
    assertWritable(project);
    if (block.stale) throw new ProductionInputError(STALE_MESSAGE);
    if (!block.handoffNotice) {
      throw new ProductionInputError("This shot does not need an update.");
    }
    const previous = await getPreviousCurrentBlock(block, tx);
    if (!previous) throw new ProductionInputError("There is no shot before this one.");
    return reviseFromHandoff(tx, {
      project,
      userId,
      previous,
      next: block,
      expectedCredits: input.expectedCredits,
    });
  });
}

/**
 * After a revision reported `next_block_needs_update`: updates the shot that follows `lineageId`
 * so it opens from the new ending (see `updateShotForHandoff`; the shot may have clips). Returns
 * the next shot's lineage id, or null when the shot is not theirs.
 */
export async function requestNextShotUpdate(input: {
  lineageId: string;
  userId: string;
  expectedCredits?: number;
}): Promise<string | null> {
  const { lineageId, userId } = parse(lineageInput, input);
  if (!isUuid(lineageId)) return null;
  return getDb().transaction(async (tx) => {
    const locked = await lockLineage(tx, lineageId, userId);
    if (!locked) return null;
    const { block, project } = locked;
    assertWritable(project);
    if (block.stale) throw new ProductionInputError(STALE_MESSAGE);
    const view = parseBlockDirection(block.direction);
    if (!view?.revision?.flags.next_block_needs_update) {
      throw new ProductionInputError("The next shot does not need an update.");
    }
    const next = await getNextCurrentBlock(block, tx);
    if (!next) throw new ProductionInputError("There is no shot after this one.");
    if (next.createdAt > block.createdAt) {
      throw new ProductionInputError("The next shot was already updated.");
    }
    return reviseFromHandoff(tx, {
      project,
      userId,
      previous: block,
      next,
      expectedCredits: input.expectedCredits,
    });
  });
}

export type ShotUpdateQuote = SpendQuote;

const quoteInput = z.object({
  lineageId: z.string(),
  userId: userIdSchema,
  of: z.enum(["self", "next"]),
});

/**
 * What updating a shot costs, for the confirmation: one draft when the shot has clips, nothing
 * otherwise. `of: "next"` prices the shot after `lineageId`. Null when it is not the user's.
 */
export async function quoteShotUpdate(input: {
  lineageId: string;
  userId: string;
  of: "self" | "next";
}): Promise<ShotUpdateQuote | null> {
  const { lineageId, userId, of } = parse(quoteInput, input);
  if (!isUuid(lineageId)) return null;
  const db = getDb();
  const opened = await openLineage(db, lineageId, userId);
  if (!opened) return null;
  let target = opened;
  if (of === "next") {
    const next = await getNextCurrentBlock(opened.block, db);
    if (!next) return null;
    const nextOpened = await openLineage(db, next.lineageId, userId);
    if (!nextOpened) return null;
    target = nextOpened;
  }
  const take = await latestLiveTake(db, target.block.lineageId);
  if (!take) {
    return {
      spends: false,
      credits: 0,
      unit: 0,
      balance: await getBalance(userId),
      maxGenerations: 0,
    };
  }
  return quoteSpend({
    userId,
    purpose: "block_draft",
    style: requireStyle(target.project),
  });
}
