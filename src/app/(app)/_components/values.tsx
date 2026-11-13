import type { ReactNode } from "react";
import { cn } from "@/ui";
import { formatNumber, formatWhen } from "../_lib/format";

/**
 * A technical value set in Geist Mono with tabular figures: a timecode, a duration, a price in
 * credits. Everything around it stays in Geist.
 */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono tabular-nums", className)}>{children}</span>;
}

/** A number of credits: mono and tabular, so prices line up and do not jump. */
export function Amount({ n }: { n: number }) {
  return <Mono>{formatNumber(n)}</Mono>;
}

/** "1 credit", "140 credits", with the number in mono. */
export function Credits({ n }: { n: number }) {
  return (
    <>
      <Amount n={n} /> {n === 1 ? "credit" : "credits"}
    </>
  );
}

/** A date in the reader's time zone (the server render may differ, so hydration is tolerant). */
export function When({ date, className }: { date: Date; className?: string }) {
  const value = new Date(date);
  return (
    <time dateTime={value.toISOString()} suppressHydrationWarning className={className}>
      {formatWhen(value)}
    </time>
  );
}

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
  /** The subject of the sentence: "A new draft", "Creating this image". */
  action: string;
}) {
  if (price === null) return null;
  if (balance >= price) {
    return (
      <p className="text-secondary text-pretty text-label-2">
        {action} costs <Credits n={price} />. You have <Amount n={balance} />.
      </p>
    );
  }
  return (
    <p role="status" className="text-secondary text-pretty text-label">
      You need <Credits n={price} /> and have <Amount n={balance} />. Add credits to your account to
      continue.
    </p>
  );
}

/**
 * An error under a control, read out when it appears. `className` sets the screen's own
 * treatment (colour, entrance); the default is the Pre-production one.
 */
export function ErrorLine({
  id,
  children,
  className = "swap-in text-red",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className={cn("text-secondary", className)}>
      {children}
    </p>
  );
}
