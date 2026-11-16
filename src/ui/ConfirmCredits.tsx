"use client";

import { useId, type ReactNode } from "react";
import { Button } from "./Button";
import { cn } from "./cn";
import { Sheet } from "./Dialog";

export interface ConfirmCreditsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A question that names the step, e.g. "Create this image?". */
  title: string;
  /** What is made, in a sentence or two. */
  description?: ReactNode;
  /** What this step costs in credits (the total the user confirms). */
  credits: number;
  /** The user's balance now. */
  balance: number;
  /**
   * More than 1 when the step makes several images charged one by one (a pack's views): `credits`
   * is then the price of one and the sheet says how many may be made.
   */
  maxGenerations?: number;
  /** The "Don't ask again" tick. */
  dontAskAgain: boolean;
  onDontAskAgainChange: (value: boolean) => void;
  onConfirm: () => void;
  /** The confirm button's label (default "Confirm"). */
  confirmLabel?: string;
  /** Pending: the confirm button spins, the sheet cannot be dismissed. */
  loading?: boolean;
  /** A quiet line above the price, e.g. "The price changed". */
  notice?: ReactNode;
  /** Shown in red when the step failed; say what to do next. */
  error?: ReactNode;
}

const formatter = new Intl.NumberFormat("en-US");
const n = (value: number) => formatter.format(value);
const word = (value: number) => (value === 1 ? "credit" : "credits");

function Row({
  label,
  children,
  strong,
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-3">
      <dt className="text-secondary text-label-2">{label}</dt>
      <dd
        className={cn(
          "font-mono tabular-nums",
          strong ? "text-heading-sm text-label" : "text-row text-label-2",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * The confirmation before credits are spent: the price, the balance after it, a "Don't ask again"
 * tick, Confirm and Cancel. Presentational: the screen decides when it opens (it does not at all
 * when the user turned the question off) and what Confirm does. Confirm is disabled when the
 * balance does not cover the price.
 */
export function ConfirmCredits({
  open,
  onOpenChange,
  title,
  description,
  credits,
  balance,
  maxGenerations = 1,
  dontAskAgain,
  onDontAskAgainChange,
  onConfirm,
  confirmLabel = "Confirm",
  loading = false,
  notice,
  error,
}: ConfirmCreditsProps) {
  const tickId = useId();
  const several = maxGenerations > 1;
  const short = balance < credits;
  const after = balance - credits;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (loading && !next) return;
        onOpenChange(next);
      }}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="plain" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={loading} disabled={short}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" aria-live="polite">
        {notice ? <p className="text-secondary text-pretty text-label">{notice}</p> : null}
        <dl className="divide-y divide-separator border-y border-separator">
          <Row label={several ? "Price of each view" : "Price"} strong>
            {n(credits)} {word(credits)}
          </Row>
          {several ? <Row label="Views made">up to {maxGenerations}</Row> : null}
          <Row label="Your balance">{n(balance)}</Row>
          <Row label={several ? "Balance after one view" : "Balance after"}>
            {short ? "Not enough" : n(after)}
          </Row>
        </dl>
        {several ? (
          <p className="text-secondary text-pretty text-label-2">
            Views are charged one by one as they are made, and only for the ones that succeed.
          </p>
        ) : null}
        {short ? (
          <p role="status" className="text-secondary text-pretty text-label">
            You need {n(credits - balance)} more {word(credits - balance)}. Add credits to your
            account to continue.
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <button
            id={tickId}
            type="button"
            role="checkbox"
            aria-checked={dontAskAgain}
            disabled={loading}
            onClick={() => onDontAskAgainChange(!dontAskAgain)}
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-[4px] border focus-ring transition-colors motion-reduce:transition-none",
              dontAskAgain ? "border-brand bg-brand" : "border-outline",
            )}
          >
            {dontAskAgain ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 10 10"
                className="size-3 text-ground"
                fill="none"
              >
                <path d="M2 5.2 4.2 7.4 8 2.8" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            ) : null}
          </button>
          <label htmlFor={tickId} className="text-secondary text-label-2 select-none">
            Don’t ask again. You can turn this back on in Account.
          </label>
        </div>
        {error ? (
          <p role="alert" className="text-secondary text-pretty text-failed">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
