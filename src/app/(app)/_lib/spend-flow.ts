/**
 * The decision flow of a step that spends credits, free of React so it can be tested: read the
 * price, ask the user unless they turned the question off (and the balance covers it), submit with
 * the confirmed price, and ask again with the new price when the server says it changed. The
 * server re-checks the price on every submit whatever the user's choice is: this flow only decides
 * whether the screen shows the dialog.
 */
import type { ActionFailure, ActionResult } from "./action";

/** What a step costs (see `quoteSpendAction`). */
export interface FlowQuote {
  spends: boolean;
  credits: number;
  balance: number;
  /** The user turned the dialog off. */
  skip: boolean;
}

export interface FlowOutcome {
  ok: boolean;
  priceChanged?: boolean;
}

export interface FlowDeps<Q extends FlowQuote, R extends FlowOutcome> {
  quote: () => Promise<ActionResult<Q>>;
  /** Shows the dialog; resolves with what the user chose. */
  ask: (quote: Q, notice: string | null) => Promise<{ confirmed: boolean; dontAskAgain: boolean }>;
  /** Saves "don't ask again". */
  saveSkip: () => Promise<unknown>;
  /** Sends the step with the confirmed price. */
  submit: (expectedCredits: number) => Promise<R>;
}

export const PRICE_CHANGED_NOTICE = "The price changed. Check the new price, then confirm.";
export const PRICE_KEEPS_CHANGING = "The price keeps changing. Try again in a moment.";
export const MAX_ATTEMPTS = 3;

/**
 * Resolves to the step's result, to the failure of reading the price, or to null when the user
 * cancelled (nothing was sent).
 */
export async function runSpendFlow<Q extends FlowQuote, R extends FlowOutcome>(
  deps: FlowDeps<Q, R>,
): Promise<R | ActionFailure | null> {
  let notice: string | null = null;
  let mustAsk = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const quoted = await deps.quote();
    if (!quoted.ok) return quoted;
    const quote = quoted.data;
    // Nothing to pay (an approval): the server ignores the price.
    if (!quote.spends) return deps.submit(0);
    const short = quote.balance < quote.credits;
    if (!quote.skip || mustAsk || short) {
      const decision = await deps.ask(quote, notice);
      if (!decision.confirmed) return null;
      if (decision.dontAskAgain) await deps.saveSkip();
    }
    const result = await deps.submit(quote.credits);
    if (!result.ok && result.priceChanged) {
      mustAsk = true;
      notice = PRICE_CHANGED_NOTICE;
      continue;
    }
    return result;
  }
  return { ok: false, error: PRICE_KEEPS_CHANGING };
}
