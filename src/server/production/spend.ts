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
import type { TakeStage } from "@/server/db/schema";
import { confirmSpend, PriceChangedError, quoteSpend, type SpendQuote } from "@/server/generation";
import { isUuid, openLineage, parse, requireStyle, userIdSchema, type ProjectRow } from "./access";
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
});

/**
 * What a decision on a take costs, for the confirmation: accepting a draft starts its final,
 * rejecting a take starts a new draft, a failed take run again costs its own stage; accepting a
 * final costs nothing. Null when the take is missing or not the user's.
 */
export async function quoteTakeSpend(input: {
  takeId: string;
  userId: string;
  action: "accept" | "reject" | "retry";
}): Promise<SpendQuote | null> {
  const { takeId, userId, action } = parse(quoteInput, input);
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
  return quoteSpend({ userId, purpose: purposeOf(stage), style: requireStyle(opened.project) });
}
