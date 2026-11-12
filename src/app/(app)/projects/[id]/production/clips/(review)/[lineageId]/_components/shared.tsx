"use client";

import type { ReactNode } from "react";
import { Credits, Mono } from "../../../../_components/values";

export interface IssueChoice {
  code: string;
  label: string;
  hint: string;
}

const numberFormat = new Intl.NumberFormat("en-US");
export const formatNumber = (n: number) => numberFormat.format(n);

const credits = (n: number) => `${formatNumber(n)} ${n === 1 ? "credit" : "credits"}`;

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** A date in the reader's time zone (the server render may differ, so hydration is tolerant). */
export function When({ date }: { date: Date }) {
  const value = new Date(date);
  return (
    <time dateTime={value.toISOString()} suppressHydrationWarning className="tabular-nums">
      {dateFormat.format(value)}
    </time>
  );
}

export const canAfford = (price: number | null, balance: number) =>
  price === null || balance >= price;

/**
 * What a step costs and the balance, in one quiet line ("A new draft costs 20 credits. You have
 * 540."); says what to do when the balance is short.
 */
export function CreditLine({
  price,
  balance,
  action,
}: {
  price: number | null;
  balance: number;
  /** The subject of the sentence: "A new draft", "Trying again". */
  action: string;
}) {
  if (price === null) return null;
  if (balance >= price) {
    return (
      <p className="text-secondary text-pretty text-label-2">
        {action} costs <Credits n={price} />. You have <Mono>{formatNumber(balance)}</Mono>.
      </p>
    );
  }
  return (
    <p role="status" className="text-secondary text-pretty text-label">
      You need <Credits n={price} /> and have <Mono>{formatNumber(balance)}</Mono>. Add credits to
      your account to continue.
    </p>
  );
}

export { credits as creditWords };

/** An error under a control, read out when it appears. */
export function ErrorLine({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-secondary text-failed">
      {children}
    </p>
  );
}
