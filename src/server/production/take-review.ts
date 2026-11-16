/** Reviewing takes (draft, then final), and running a failed take again. */
import { and, eq } from "drizzle-orm";
import { type DbTx, getDb } from "@/server/db/client";
import { blockTake, review } from "@/server/db/schema";
import { enqueue, takeFix, takeGenerate } from "@/server/jobs";
import { logProjectEvent } from "@/server/projects";
import { assertWritable, isUuid, lockLineage, parse, reviewReason, STALE_MESSAGE } from "./access";
import { ProductionInputError } from "./errors";
import { retryTakeInput, takeReviewInput } from "./inputs";
import { NOT_IN_REVIEW } from "./messages";
import { confirmTakeSpend } from "./spend";
import type { BlockProductionStage } from "./stage";
import { getTake, insertTake, latestLiveTake, type TakeRow } from "./takes";

/** The pending take's job, on the transaction that created (or reset) it. */
async function enqueueTakeJob(tx: DbTx, take: Pick<TakeRow, "id" | "prompt">): Promise<void> {
  await enqueue(take.prompt ? takeGenerate : takeFix, { takeId: take.id }, { tx });
}

/**
 * Accepts or rejects the lineage's latest take in review, recording the review with the dami run
 * that wrote its prompt. Draft accepted: a final take is made from exactly that draft
 * (`take.generate`). Final accepted: the block is done. Rejected (a note is needed):
 * a new draft with a fixed prompt (`take.fix`). Both of those spend credits: `expectedCredits`
 * must be the price the user saw (`PriceChangedError` otherwise, `InsufficientCreditsError` when
 * the balance is short), and it is stored on the new take as all the worker may spend on it.
 */
export async function submitTakeReview(input: {
  takeId: string;
  userId: string;
  decision: "accepted" | "rejected";
  note?: string;
  expectedCredits?: number;
}): Promise<BlockProductionStage | null> {
  const parsed = parse(takeReviewInput, input);
  const { takeId, userId, decision } = parsed;
  if (!isUuid(takeId)) return null;
  const reason = reviewReason(decision, parsed.note);
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
    const spends = !(decision === "accepted" && latest.stage === "final");
    const confirmedCredits = spends
      ? await confirmTakeSpend(
          tx,
          project,
          userId,
          decision === "accepted" ? "final" : "draft",
          parsed.expectedCredits,
        )
      : null;
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
      await logProjectEvent(tx, {
        projectId: project.id,
        userId,
        type: "production.take_accepted",
        payload: event,
      });
      return { stage: "done" as const };
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
        confirmedCredits,
      });
      await logProjectEvent(tx, {
        projectId: project.id,
        userId,
        type: "production.take_accepted",
        payload: {
          ...event,
          finalTakeId: final.id,
        },
      });
      await enqueueTakeJob(tx, final);
      return { stage: "final_generating" as const };
    }
    const next = await insertTake(tx, {
      projectId: project.id,
      blockId: block.id,
      lineageId: block.lineageId,
      stage: "draft",
      status: "pending",
      parentId: latest.id,
      confirmedCredits,
    });
    await logProjectEvent(tx, {
      projectId: project.id,
      userId,
      type: "production.take_rejected",
      payload: {
        ...event,
        nextTakeId: next.id,
      },
    });
    await enqueueTakeJob(tx, next);
    return { stage: "draft_generating" as const };
  });
  if (!outcome) return null;
  return outcome.stage;
}

/**
 * Runs the lineage's latest take again after it failed: back to pending and its job re-enqueued.
 * The job re-runs the take-fixer only when no prompt was stored; the failed generation's credits
 * were refunded and are never reused. Spends again, so `expectedCredits` must be the price the
 * user saw (see `submitTakeReview`).
 */
export async function retryTake(input: {
  takeId: string;
  userId: string;
  expectedCredits?: number;
}): Promise<BlockProductionStage | null> {
  const { takeId, userId, expectedCredits } = parse(retryTakeInput, input);
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
    const confirmedCredits = await confirmTakeSpend(
      tx,
      project,
      userId,
      latest.stage,
      expectedCredits,
    );
    const [updated] = await tx
      .update(blockTake)
      .set({ status: "pending", failure: null, generationId: null, confirmedCredits })
      .where(and(eq(blockTake.id, takeId), eq(blockTake.status, "failed")))
      .returning();
    // The row is reset for the new attempt; the event keeps the link to the failed one.
    await logProjectEvent(tx, {
      projectId: project.id,
      userId,
      type: "production.take_retried",
      payload: {
        lineageId: block.lineageId,
        takeId,
        stage: latest.stage,
        previousGenerationId: latest.generationId,
        previousFailure: latest.failure,
      },
    });
    if (updated) await enqueueTakeJob(tx, updated);
    return updated ?? null;
  });
  if (!take) return null;
  return take.stage === "final" ? "final_generating" : "draft_generating";
}
