/**
 * What the takes cost and the confirmation of them: a draft (`block_draft`), a final
 * (`block_final`). Accepting a draft makes a final, rejecting any take makes a new draft, and a
 * failed take run again spends once more: each needs the price the user saw (`expectedCredits`).
 * The confirmed price is stored on the new take (`confirmedCredits`), which is all the worker may
 * spend on it.
 */
import { z } from "zod";
import { getBalance } from "@/server/billing";
import { type DbExecutor, getDb } from "@/server/db/client";
import type { TakeRoute, TakeStage } from "@/server/db/schema";
import { confirmSpend, PriceChangedError, quoteSpend, type SpendQuote } from "@/server/generation";
import { isUuid, openLineage, parse, requireStyle, userIdSchema, type ProjectRow } from "./access";
import { timedNoteSchema } from "./revision-request";
import { planTakeRoute } from "./take-routing";
import { getTake, latestLiveTake } from "./takes";

const purposeOf = (stage: TakeStage) => (stage === "final" ? "block_final" : "block_draft");

/**
 * Re-quotes the take of `stage`, compares with `expectedCredits` and checks the balance. Returns
 * the confirmed price to store on the take. `db` is the caller's transaction.
 */
export async function confirmTakeSpend(
  db: DbExecutor,
  project: ProjectRow,
  userId: string,
  stage: TakeStage,
  expectedCredits: number | undefined,
): Promise<number> {
  if (expectedCredits === undefined) throw new PriceChangedError("Confirm the price first.");
  return confirmSpend({
    userId,
    purpose: purposeOf(stage),
    style: requireStyle(project),
    expectedCredits,
    db,
  });
}

const quoteInput = z.object({
  takeId: z.string(),
  userId: userIdSchema,
  action: z.enum(["accept", "reject", "retry"], { error: "Unknown action." }),
  /** For a rejection: what the user decided, so the quote names the route that will run. */
  review: z
    .object({
      note: z.string().trim().max(2000).optional(),
      confirmedIssueIds: z.array(z.string().max(40)).max(50).optional(),
      keepIds: z.array(z.string().max(40)).max(50).optional(),
      timedNotes: z.array(timedNoteSchema).max(20).optional(),
    })
    .optional(),
});

/** A quote, with the route a rejection will take when the user's decision was given. */
export type TakeSpendQuote = SpendQuote & {
  route?: Extract<TakeRoute, "reroll" | "revise" | "rebind">;
};

/**
 * What a decision on a take costs, for the confirmation: accepting a draft starts its final,
 * rejecting a take starts a new draft, a failed take run again costs its own stage; accepting a
 * final costs nothing. Every route of a rejection (reroll, rebind, revise) ends in one new draft,
 * so the price is the draft's whichever runs; with `review` the quote also says which route that
 * is (it is also what the confirmation shows). Null when the take is missing or not the user's.
 */
export async function quoteTakeSpend(input: {
  takeId: string;
  userId: string;
  action: "accept" | "reject" | "retry";
  review?: {
    note?: string;
    confirmedIssueIds?: string[];
    keepIds?: string[];
    timedNotes?: { fromS: number; toS: number; text: string }[];
  };
}): Promise<TakeSpendQuote | null> {
  const { takeId, userId, action, review } = parse(quoteInput, input);
  if (!isUuid(takeId)) return null;
  const db = getDb();
  const take = await getTake(db, takeId);
  if (!take) return null;
  const opened = await openLineage(db, take.lineageId, userId);
  if (!opened) return null;
  const latest = await latestLiveTake(db, take.lineageId);
  if (!latest || latest.id !== takeId) return null;
  let stage: TakeStage = take.stage;
  if (action === "accept") {
    if (take.stage === "final") {
      return {
        spends: false,
        credits: 0,
        unit: 0,
        balance: await getBalance(userId),
        maxGenerations: 0,
      };
    }
    stage = "final";
  } else if (action === "reject") {
    stage = "draft";
  }
  const quote = await quoteSpend({
    userId,
    purpose: purposeOf(stage),
    style: requireStyle(opened.project),
  });
  if (action !== "reject" || !review) return quote;
  const planned = await planTakeRoute(db, {
    take: latest,
    block: opened.block,
    choice: {
      confirmedIssueIds: review.confirmedIssueIds ?? [],
      keepIds: review.keepIds,
      timedNotes: review.timedNotes ?? [],
      note: review.note ? review.note : null,
    },
  }).catch(() => null);
  return planned ? { ...quote, route: planned.route } : quote;
}
