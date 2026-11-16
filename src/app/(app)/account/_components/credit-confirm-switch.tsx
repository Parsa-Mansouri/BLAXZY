"use client";

import { useId, useState, useTransition } from "react";
import { cn } from "@/ui";
import { setSkipCreditConfirmAction } from "../../_lib/spend-actions";

/**
 * "Ask before spending credits": on (the default) shows the price and asks before every paid
 * generation; off skips the question. The servers check the price either way.
 */
export function CreditConfirmSwitch({ initialSkip }: { initialSkip: boolean }) {
  const id = useId();
  const [ask, setAsk] = useState(!initialSkip);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !ask;
    setError(null);
    startTransition(async () => {
      const result = await setSkipCreditConfirmAction(!next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAsk(!result.data.skip);
    });
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex enter flex-col gap-3">
      <h2 id={`${id}-title`} className="text-section">
        Spending
      </h2>
      <div className="flex items-center justify-between gap-6">
        <div className="flex flex-col gap-1">
          <span id={`${id}-label`} className="text-row text-label">
            Ask before spending credits
          </span>
          <span
            id={`${id}-hint`}
            className="max-w-(--measure) text-secondary text-pretty text-label-2"
          >
            {ask
              ? "You see the price and confirm before every image or clip is made."
              : "Images and clips are made at once, at the price shown on the button. The price is still checked every time."}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={ask}
          aria-label="Ask before spending credits"
          aria-describedby={`${id}-hint`}
          disabled={pending}
          onClick={toggle}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-capsule border focus-ring transition-colors motion-reduce:transition-none",
            ask ? "border-brand bg-brand" : "border-outline bg-fill-2",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-0.5 left-0.5 size-5.5 rounded-full bg-accent transition-transform motion-reduce:transition-none",
              ask ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-secondary text-failed">
          {error}
        </p>
      ) : null}
    </section>
  );
}
