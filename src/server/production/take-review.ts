/** Reviewing takes (draft, then final), and running a failed take again. */
import { and, eq } from "drizzle-orm";
import { type DbTx, getDb } from "@/server/db/client";
import { blockTake, review } from "@/server/db/schema";
import { enqueue, takeGenerate } from "@/server/jobs";
import { logProjectEvent } from "@/server/projects";
import { assertWritable, isUuid, lockLineage, parse, reviewReason, STALE_MESSAGE } from "./access";
import { ProductionInputError } from "./errors";
import { retryTakeInput, takeReviewInput } from "./inputs";
import { NOT_IN_REVIEW } from "./messages";
import { afterTakeAccepted } from "./accept-effects";
import { requestBlockRevision } from "./revision";
import { confirmTakeSpend } from "./spend";
import { planTakeRoute } from "./take-routing";
import type { BlockProductionStage } from "./stage";
import { getTake, insertTake, latestLiveTake, supersedeLineageTakes, type TakeRow } from "./takes";

/** The pending take's job, on the transaction that created (or reset) it. */
async function enqueueTakeJob(tx: DbTx, take: Pick<TakeRow, "id">): Promise<void> {
  await enqueue(takeGenerate, { takeId: take.id }, { tx });
}

/**
 * Accepts or rejects the lineage's latest take in review, recording the review with the dami run
 * that wrote its prompt. Draft accepted: a final take is made from exactly that draft
 * (`take.generate`). Final accepted: the block is done. Rejected: the router (`take-routing`)
 * decides from the clip's Video Review report and what the user confirmed (findings left standing,
 * a note, notes on a time range): a reroll or a rebind is a new draft of the same prompt; a
 * revision asks Block Revision for the next version of the shot, which then gets its draft. A
 * rejection needs a note, a timed note or a finding left standing. Both a final and a new draft
 * spend credits: `expectedCredits` must be the price the user saw (`PriceChangedError`
 * otherwise, `InsufficientCreditsError` when the balance is short), and it is stored as all the
 * worker may spend on the new draft.
 */
export async function submitTakeReview(input: {
  takeId: string;
  userId: string;
  decision: "accepted" | "rejected";
  note?: string;
  /** Rejections: the findings of the clip's review left standing, the points to keep (all when not given) and notes on a time range. */
  confirmedIssueIds?: string[];
  keepIds?: string[];
  timedNotes?: { fromS: number; toS: number; text: string }[];
  expectedCredits?: number;
}): Promise<BlockProductionStage | null> {
  const parsed = parse(takeReviewInput, input);
  const { takeId, userId, decision } = parsed;
  if (!isUuid(takeId)) return null;
  // A rejection's reason is checked by the router (a note, a timed note or a finding).
  const reason =
    decision === "accepted"
      ? reviewReason(decision, parsed.note)
      : { issueCodes: [] as string[], note: parsed.note ? parsed.note : null };
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
    const takePlan =
      decision === "rejected"
        ? await planTakeRoute(tx, {
            take: latest,
            block,
            choice: {
              confirmedIssueIds: parsed.confirmedIssueIds ?? [],
              keepIds: parsed.keepIds,
              timedNotes: parsed.timedNotes ?? [],
              note: reason.note,
            },
          })
        : null;
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
    const [decided] = await tx
      .insert(review)
      .values({
        projectId: project.id,
        userId,
        subjectType: "generation",
        subjectId: takeId,
        decision,
        issueCodes: reason.issueCodes,
        note: reason.note,
        revisionRequest: takePlan?.request ?? null,
        confirmedCredits: takePlan ? confirmedCredits : null,
        damiRunId: latest.damiRunId,
      })
      .returning({ id: review.id });
    if (!decided) throw new Error("review insert returned no row");
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
    if (decision === "accepted") {
      const effects = await afterTakeAccepted(tx, { block, take: latest, userId });
      if (effects.noticeBlockId) Object.assign(event, { handoffBlockId: effects.noticeBlockId });
    }
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
    if (!takePlan) throw new Error("a rejection has a plan");
    if (takePlan.route === "revise") {
      // The next version of the shot is prepared by Block Revision, and its draft follows (see
      // `revision-draft`): nothing is generated until then.
      await requestBlockRevision({ tx, blockId: block.id, userId, reviewId: decided.id });
      // The old version's other clips (an accepted draft of a rejected final) belong to it.
      await supersedeLineageTakes(tx, project.id, [block.lineageId]);
      await logProjectEvent(tx, {
        projectId: project.id,
        userId,
        type: "production.take_rejected",
        payload: { ...event, route: "revise", reviewId: decided.id },
      });
      return { stage: "preparing" as const };
    }
    const next = await insertTake(tx, {
      projectId: project.id,
      blockId: block.id,
      lineageId: block.lineageId,
      stage: "draft",
      status: "pending",
      parentId: latest.id,
      prompt: latest.prompt,
      referenceFileIds: takePlan.referenceFileIds,
      damiRunId: latest.damiRunId,
      route: takePlan.route,
      confirmedCredits,
    });
    await logProjectEvent(tx, {
      projectId: project.id,
      userId,
      type: "production.take_rejected",
      payload: {
        ...event,
        route: takePlan.route,
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
 * The failed generation's credits were refunded and are never reused. Spends again, so `expectedCredits` must be the price the
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
