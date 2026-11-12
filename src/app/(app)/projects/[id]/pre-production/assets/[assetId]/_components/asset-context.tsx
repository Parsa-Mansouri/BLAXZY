"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@/ui";
import type { MoveOn } from "../actions";

export interface AssetScreenContextValue {
  /** Refreshes the page after an action, then checks twice that nothing was missed. */
  refresh: () => void;
  /**
   * After an action that started a job (or made the asset ready): with `MoveOn`, says what started
   * and goes to the next asset that waits for the user (or the overview); with null, `refresh`.
   */
  moveOn: (data: MoveOn | null, started: string) => void;
  /**
   * False while the screen is first shown, true afterwards: a panel that mounts later was reached
   * by the user's action (or by a finished generation), so it takes focus. Read it in effects only.
   */
  shown: RefObject<boolean>;
}

const AssetScreenContext = createContext<AssetScreenContextValue | null>(null);

export const AssetScreenProvider = AssetScreenContext.Provider;

export function useAssetScreen(): AssetScreenContextValue {
  const value = useContext(AssetScreenContext);
  if (!value) throw new Error("useAssetScreen must be used inside the asset screen.");
  return value;
}

/** True when nothing has focus: the control that had it was removed with the old panel. */
export function focusIsFree(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement;
}

/**
 * After a panel swap the page can be left scrolled so that the asset's name sits under the sticky
 * toolbar. Scrolls back to the top in that case only: a reader further down the page stays put.
 */
export function keepTitleVisible() {
  const title = document.querySelector<HTMLElement>("[data-asset-title]");
  if (!title) return;
  const toolbar = document.querySelector<HTMLElement>("main > header");
  const covered = (toolbar?.getBoundingClientRect().bottom ?? 0) + 4;
  if (title.getBoundingClientRect().top >= covered || window.scrollY > 240) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
}

/** Moves focus to `target` when its panel appears after the screen was first shown. */
export function useFocusOnArrival(getTarget: () => HTMLElement | null | undefined) {
  const { shown } = useAssetScreen();
  const latest = useRef(getTarget);
  useEffect(() => {
    latest.current = getTarget;
  });
  useEffect(() => {
    if (!shown.current || !focusIsFree()) return;
    latest.current()?.focus({ preventScroll: true });
    keepTitleVisible();
  }, [shown]);
}

/** The heading of a panel: takes focus when the panel appears, so the change is announced. */
export function StageHeading({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(() => ref.current);
  return (
    <h2
      ref={ref}
      id={id}
      tabIndex={-1}
      className={cn("scroll-mt-[calc(var(--toolbar-h)+1rem)] outline-none", className)}
    >
      {children}
    </h2>
  );
}
