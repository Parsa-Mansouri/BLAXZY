"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmCredits } from "@/ui";
import {
  quoteSpendAction,
  setSkipCreditConfirmAction,
  type SpendQuoteData,
  type SpendTarget,
} from "../_lib/spend-actions";
import type { ActionFailure } from "../_lib/action";
import { runSpendFlow } from "../_lib/spend-flow";

/** What a step that spends needs from the screen. */
export interface SpendRequest<R> {
  /** What to price (see `quoteSpendAction`). */
  target: SpendTarget;
  /** A question that names the step: "Create this image?". */
  title: string;
  /** What is made, in a sentence (or from the quote, once it is read). */
  description?: ReactNode | ((quote: SpendQuoteData) => ReactNode);
  /** The confirm button's label. */
  confirmLabel?: string;
  /**
   * Sends the step with the price the user confirmed (the server re-checks it). `priceChanged`
   * in a failure makes the dialog open again with the new price.
   */
  submit: (expectedCredits: number) => Promise<R>;
}

type Outcome = { ok: boolean; priceChanged?: boolean };

interface Pending {
  request: { title: string; description?: ReactNode; confirmLabel?: string };
  quote: SpendQuoteData;
  notice: string | null;
  resolve: (decision: { confirmed: boolean; dontAskAgain: boolean }) => void;
}

interface SpendApi {
  run: <R extends Outcome>(request: SpendRequest<R>) => Promise<R | ActionFailure | null>;
}

const SpendContext = createContext<SpendApi | null>(null);

/**
 * Hosts the one credit confirmation of the signed-in window. Screens call `useSpend().run`, which
 * prices the step, asks (unless the user turned the question off and the balance covers it) and
 * submits with the confirmed price. The server checks the price whatever the choice is.
 */
export function SpendConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [dontAsk, setDontAsk] = useState(false);
  const open = useRef<Pending | null>(null);

  useEffect(() => {
    return () => {
      open.current?.resolve({ confirmed: false, dontAskAgain: false });
    };
  }, []);

  const ask = useCallback(
    (
      request: SpendRequest<Outcome>,
      quote: SpendQuoteData,
      notice: string | null,
    ): Promise<{ confirmed: boolean; dontAskAgain: boolean }> =>
      new Promise((resolve) => {
        const next: Pending = {
          request: {
            title: request.title,
            confirmLabel: request.confirmLabel,
            description:
              typeof request.description === "function"
                ? request.description(quote)
                : request.description,
          },
          quote,
          notice,
          resolve: (decision) => {
            open.current = null;
            setPending(null);
            resolve(decision);
          },
        };
        open.current?.resolve({ confirmed: false, dontAskAgain: false });
        open.current = next;
        setDontAsk(false);
        setPending(next);
      }),
    [],
  );

  const run = useCallback(
    <R extends Outcome>(request: SpendRequest<R>): Promise<R | ActionFailure | null> =>
      runSpendFlow<SpendQuoteData, R>({
        quote: () => quoteSpendAction(request.target),
        ask: (quote, notice) => ask(request, quote, notice),
        saveSkip: () => setSkipCreditConfirmAction(true),
        submit: request.submit,
      }),
    [ask],
  );

  const api = useMemo<SpendApi>(() => ({ run }), [run]);
  const quote = pending?.quote;
  return (
    <SpendContext.Provider value={api}>
      {children}
      {pending && quote ? (
        <ConfirmCredits
          open
          onOpenChange={(next) => {
            if (!next) pending.resolve({ confirmed: false, dontAskAgain: false });
          }}
          title={pending.request.title}
          description={pending.request.description}
          confirmLabel={pending.request.confirmLabel}
          credits={quote.credits}
          balance={quote.balance}
          maxGenerations={quote.maxGenerations}
          dontAskAgain={dontAsk}
          onDontAskAgainChange={setDontAsk}
          notice={pending.notice}
          onConfirm={() => pending.resolve({ confirmed: true, dontAskAgain: dontAsk })}
        />
      ) : null}
    </SpendContext.Provider>
  );
}

/**
 * Prices and confirms a step that spends credits, then submits it. Resolves to the step's result,
 * to a failure when the price could not be read, or to null when the user cancelled (do nothing).
 */
export function useSpend(): SpendApi {
  const api = useContext(SpendContext);
  if (!api) throw new Error("useSpend needs the SpendConfirmProvider");
  return api;
}
