"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";

export interface TickProps {
  /** Draw the tick in (250ms) when it appears. Default true; false shows it at once. */
  animate?: boolean;
  /** Size and colour classes. Default 16px in the brand colour. */
  className?: string;
}

/**
 * The confirmation tick: lucide's Check at stroke 1.5, drawn in from its short stroke to its
 * long one when it mounts. Render it only once the thing is done (`{done ? <Tick /> : null}`)
 * so the draw plays at that moment. Decorative: say "done" in text or `sr-only` beside it.
 */
export function Tick({ animate = true, className }: TickProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("lucide size-(--icon) shrink-0 text-brand", animate && "tick-draw", className)}
    >
      <path d="M4 12l5 5L20 6" pathLength={1} />
    </svg>
  );
}

export interface ConfirmationProps {
  /** Whether the confirmation is showing. Pair with `useFlash()` to show it for a moment. */
  show: boolean;
  /** What just happened, in a word or two. Default "Saved". */
  children?: ReactNode;
  className?: string;
}

/**
 * A small in-place confirmation: a tick that draws in and a word ("Saved", "Accepted",
 * "Copied"). It sits beside the control that did the work, fades in over 150ms and is announced
 * politely. The region stays in the page so screen readers hear every change.
 */
export function Confirmation({ show, children = "Saved", className }: ConfirmationProps) {
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex min-h-5", className)}>
      {show ? (
        <span className="inline-flex pop-in items-center gap-1.5 text-secondary text-label-2">
          <Tick />
          <span>{children}</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * `const [saved, flashSaved] = useFlash()` — `saved` is true for `duration` ms after each
 * `flashSaved()`. For Confirmation and for replaying `settle` on a row.
 */
export function useFlash(duration = 2000): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const flash = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setOn(true);
    timer.current = window.setTimeout(() => setOn(false), duration);
  }, [duration]);
  return [on, flash];
}
