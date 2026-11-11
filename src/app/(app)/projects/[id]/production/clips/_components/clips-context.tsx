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
  type RefObject,
} from "react";
import { cn } from "@/ui";

/**
 * Shared by the board and the clip pages (it lives in their layout, so it outlives a navigation
 * between shots): one polite live region, and a flag that tells the next page it was reached by
 * moving on automatically, so it takes focus at its heading.
 */
interface ClipsContextValue {
  announce: (message: string) => void;
  /** Called before an automatic navigation. */
  markArrival: () => void;
  /** True once after `markArrival`: the arriving page takes focus at its heading. */
  takeArrival: () => boolean;
}

const ClipsContext = createContext<ClipsContextValue | null>(null);

export function ClipsProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const arrived = useRef(false);
  const markArrival = useCallback(() => {
    arrived.current = true;
  }, []);
  const takeArrival = useCallback(() => {
    const was = arrived.current;
    arrived.current = false;
    return was;
  }, []);
  const timer = useRef<number | undefined>(undefined);
  const announce = useCallback((text: string) => {
    // Clear first so the same words are read again when they repeat.
    setMessage("");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(text), 60);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const value = useMemo(
    () => ({ announce, markArrival, takeArrival }),
    [announce, markArrival, takeArrival],
  );
  return (
    <ClipsContext.Provider value={value}>
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>
      {children}
    </ClipsContext.Provider>
  );
}

export function useClips(): ClipsContextValue {
  const value = useContext(ClipsContext);
  if (!value) throw new Error("useClips must be used inside the clips layout.");
  return value;
}

/** True when nothing has focus: the control that had it was removed with the old panel. */
export function focusIsFree(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement;
}

/**
 * False while a screen is first shown, true a tick later: a panel that mounts after that was
 * reached by an action or a finished render, so it takes focus.
 */
export function useShown(): RefObject<boolean> {
  const shown = useRef(false);
  useEffect(() => {
    // After a tick, not in the effect itself: development double-runs effects on mount.
    const id = window.setTimeout(() => {
      shown.current = true;
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  return shown;
}

/**
 * The heading of a state panel. It takes focus when its panel replaces another one (and focus
 * was lost with the old panel), or when the page was reached by moving on automatically.
 */
export function StateHeading({
  shown,
  className,
  children,
}: {
  shown: RefObject<boolean>;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const { takeArrival } = useClips();
  useEffect(() => {
    if (takeArrival()) {
      ref.current?.focus({ preventScroll: true });
      return;
    }
    if (!shown.current || !focusIsFree()) return;
    ref.current?.focus({ preventScroll: true });
  }, [shown, takeArrival]);
  return (
    <h3
      ref={ref}
      tabIndex={-1}
      className={cn("scroll-mt-[calc(var(--toolbar-h)+1rem)] outline-none", className)}
    >
      {children}
    </h3>
  );
}
