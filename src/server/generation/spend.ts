/**
 * The confirmation every paid generation needs. A user action that leads to spending credits
 * carries `expectedCredits` (what the screen showed). Before anything is created the service
 * re-quotes, compares and checks the balance (`confirmSpend`); the confirmed unit price is then
 * stored on the row the worker turns into a generation (`confirmedCredits`), and
 * `requestGeneration` refuses to reserve more than that. Nothing here reads the user's "don't ask
 * again" preference: that only hides the dialog, the checks always run.
 */
import { z } from "zod";
import { getBalance, InsufficientCreditsError } from "@/server/billing";
import type { DbExecutor } from "@/server/db/client";
import type { GenerationPurpose, ProjectStyle } from "@/server/db/schema";
import { PriceChangedError } from "./errors";
import { quoteGeneration } from "./service";

/** The total the screen showed, in whole credits. */
export const expectedCreditsSchema = z
  .number({ error: "Confirm the price first." })
  .int("Confirm the price first.")
  .min(0, "Confirm the price first.");

/** What a step costs, for the confirmation dialog. */
export type SpendQuote = {
  /** False when the action costs nothing (accepting a clip, say): no dialog, no `expectedCredits`. */
  spends: boolean;
  /** What the user confirms and `expectedCredits` must equal. */
  credits: number;
  /** The price of one generation. */
  unit: number;
  balance: number;
  /**
   * More than 1 when the step makes several images charged one by one (a location pack's views):
   * each costs `unit`, at most this many are made.
   */
  maxGenerations: number;
};

/** The price of a step and the user's balance. Creates nothing. */
export async function quoteSpend(input: {
  userId: string;
  purpose: GenerationPurpose;
  style: ProjectStyle;
  /** Generations the confirmed total covers (default 1). */
  generations?: number;
  maxGenerations?: number;
}): Promise<SpendQuote> {
  const generations = input.generations ?? 1;
  const [{ priceCredits }, balance] = await Promise.all([
    quoteGeneration({ purpose: input.purpose, style: input.style }),
    getBalance(input.userId),
  ]);
  return {
    spends: true,
    credits: priceCredits * generations,
    unit: priceCredits,
    balance,
    maxGenerations: input.maxGenerations ?? generations,
  };
}

/**
 * Re-quotes and compares with `expectedCredits`, then checks the balance covers the total (a
 * pack's views are charged as each is made, so the balance must cover at least the first).
 * Throws `PriceChangedError` / `InsufficientCreditsError`; otherwise returns the unit price to
 * store on the row. `db` is the caller's transaction.
 */
export async function confirmSpend(input: {
  userId: string;
  purpose: GenerationPurpose;
  style: ProjectStyle;
  expectedCredits: number;
  generations?: number;
  db?: DbExecutor;
}): Promise<number> {
  const generations = input.generations ?? 1;
  const { priceCredits } = await quoteGeneration({ purpose: input.purpose, style: input.style });
  const total = priceCredits * generations;
  if (total !== input.expectedCredits) throw new PriceChangedError();
  const balance = await getBalance(input.userId, input.db);
  if (balance < total) throw new InsufficientCreditsError(balance, total);
  return priceCredits;
}
