"use server";

import { quoteAssetReview, quoteAssetSpend } from "@/server/assets";
import { getSkipCreditConfirm, setSkipCreditConfirm } from "@/server/billing";
import { quoteProduction, quoteTakeSpend } from "@/server/production";
import { isUuid, userAction, type ActionResult } from "./action";

/** What a step costs, as the confirmation shows it. */
export interface SpendQuoteData {
  /** False when the step costs nothing: no dialog, no price to send. */
  spends: boolean;
  /** The price the user confirms (and the server compares with). */
  credits: number;
  balance: number;
  /** More than 1: a pack's views, `credits` is the price of one. */
  maxGenerations: number;
  /** The user turned the dialog off (the screen submits with this quote at once). */
  skip: boolean;
  /** Drafts only: how many shots the total covers and what one final costs. */
  drafts?: { count: number; finalsEach: number };
}

/** The step to price. */
export type SpendTarget =
  | { kind: "asset"; assetId: string; step: "look" | "sheet" }
  | {
      kind: "asset_review";
      assetId: string;
      subject: "look" | "sheet" | "view";
      decision: "accepted" | "rejected";
      designChange?: boolean;
    }
  | { kind: "take"; takeId: string; action: "accept" | "reject" | "retry" }
  | { kind: "drafts"; projectId: string };

const GONE = { ok: false, error: "This is no longer available. Reload the page." } as const;

/**
 * Reads the price of a step that spends credits, the balance and the user's "don't ask again"
 * choice. Creates nothing: the step itself re-checks the price when it is submitted.
 */
export async function quoteSpendAction(target: SpendTarget): Promise<ActionResult<SpendQuoteData>> {
  return userAction("read", "spend.quote", async (user) => {
    const skip = await getSkipCreditConfirm(user.id);
    switch (target.kind) {
      case "asset": {
        const q = await quoteAssetSpend({ ...target, userId: user.id });
        return q ? { ok: true, data: { ...q, skip } } : GONE;
      }
      case "asset_review": {
        const q = await quoteAssetReview({ ...target, userId: user.id });
        return q ? { ok: true, data: { ...q, skip } } : GONE;
      }
      case "take": {
        const q = await quoteTakeSpend({ ...target, userId: user.id });
        return q ? { ok: true, data: { ...q, skip } } : GONE;
      }
      case "drafts": {
        if (!isUuid(target.projectId)) return GONE;
        const q = await quoteProduction(target.projectId, user.id);
        if (!q) return GONE;
        return {
          ok: true,
          data: {
            spends: q.drafts.count > 0,
            credits: q.drafts.credits,
            balance: q.balance,
            maxGenerations: 1,
            skip,
            drafts: { count: q.drafts.count, finalsEach: q.finalsEach },
          },
        };
      }
    }
  });
}

/** Turns the credit dialog off (true) or back on (false) for the signed-in user. */
export async function setSkipCreditConfirmAction(
  skip: boolean,
): Promise<ActionResult<{ skip: boolean }>> {
  return userAction("mutate", "spend.setSkip", async (user) => {
    const stored = await setSkipCreditConfirm(user.id, skip === true);
    return { ok: true, data: { skip: stored } };
  });
}
