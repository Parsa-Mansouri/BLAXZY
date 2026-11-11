"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Sheet, Skeleton } from "@/ui";
import { creditsWords, formatNumber, shotsWords } from "../../_components/format";
import { clipsHref } from "../../../_lib/production-routes";
import { quoteAction, startDraftsAction, type Quote } from "../actions";
import { refreshCredits } from "../../../../../_lib/credits";

/**
 * What the drafts will cost, in plain words, then the confirmation. The price is read when the
 * sheet opens; if it changed by the time of the confirmation the new price is shown instead.
 */
export function GenerateSheet({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, startStarting] = useTransition();

  // Read the price when the sheet opens; the sheet is mounted only while open.
  useEffect(() => {
    if (!open) return;
    let active = true;
    void quoteAction(projectId).then((result) => {
      if (!active) return;
      if (result.ok) setQuote(result.data);
      else setError(result.error);
    });
    return () => {
      active = false;
    };
  }, [open, projectId]);

  const short = quote ? quote.balance < quote.credits : false;

  function confirm() {
    if (!quote) return;
    setError(null);
    startStarting(async () => {
      const result = await startDraftsAction(projectId, quote.credits);
      if (result.ok) {
        refreshCredits();
        router.push(clipsHref(projectId));
        return;
      }
      if (result.priceChanged) {
        const fresh = await quoteAction(projectId);
        if (fresh.ok) {
          setQuote(fresh.data);
          setNotice("The price changed. Check the new price, then confirm.");
          return;
        }
      }
      setError(result.error);
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (starting && !next) return;
        onOpenChange(next);
      }}
      title="Generate Drafts"
      description="A draft is a quick, lower-quality version of a shot. Check the action and framing before the full-quality clip is made."
      footer={
        <>
          <Button variant="plain" onClick={() => onOpenChange(false)} disabled={starting}>
            Cancel
          </Button>
          <Button
            variant="prominent"
            loading={starting}
            disabled={!quote || short || quote.count === 0}
            onClick={confirm}
          >
            Generate Drafts
          </Button>
        </>
      }
    >
      <div className="flex min-h-16 flex-col gap-3" aria-live="polite">
        {quote ? (
          quote.count === 0 ? (
            <p className="text-body text-label-2">No approved shots are waiting for a draft.</p>
          ) : (
            <>
              <p className="text-reading tabular-nums">
                Drafts for {shotsWords(quote.count)} cost {creditsWords(quote.credits)}. You have{" "}
                {formatNumber(quote.balance)}.
              </p>
              <p className="text-body text-label-2 tabular-nums">
                Each shot you accept is then finished in full quality for{" "}
                {creditsWords(quote.finalsEach)}. Finishing{" "}
                {quote.count === 1
                  ? "this shot"
                  : quote.count === 2
                    ? "both shots"
                    : `all ${shotsWords(quote.count)}`}{" "}
                in full quality would cost {creditsWords(quote.count * quote.finalsEach)} more.
              </p>
              {short ? (
                <p role="status" className="text-callout text-orange tabular-nums">
                  You need {creditsWords(quote.credits - quote.balance)} more. Add credits to your
                  account to continue.
                </p>
              ) : null}
            </>
          )
        ) : error ? null : (
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}
        {notice ? <p className="text-callout text-orange">{notice}</p> : null}
        {error ? (
          <p role="alert" className="text-callout text-red">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
