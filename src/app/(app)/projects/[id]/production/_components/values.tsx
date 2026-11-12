import type { ReactNode } from "react";
import { cn } from "@/ui";
import { formatNumber } from "./format";

/**
 * A technical value set in Geist Mono with tabular figures: a timecode, a duration, a price in
 * credits. Everything around it stays in Geist.
 */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono tabular-nums", className)}>{children}</span>;
}

/** "1 credit", "140 credits", with the number in mono. */
export function Credits({ n }: { n: number }) {
  return (
    <>
      <Mono>{formatNumber(n)}</Mono> {n === 1 ? "credit" : "credits"}
    </>
  );
}
