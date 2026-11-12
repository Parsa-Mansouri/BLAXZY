"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/ui";

/**
 * Small motion that confirms what just happened: a tick drawing in, an element settling into its
 * new state, a short shake on an error. 150 to 300ms on the app's curve, nothing under reduced
 * motion. The kit has no such primitives yet, so they live here (Web Animations, no CSS needed).
 */
const EASE = "cubic-bezier(.32,.72,0,1)";

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** A short horizontal shake (250ms): the input next to an error was not accepted. */
export function shake(element: HTMLElement | null): void {
  if (!element || reducedMotion()) return;
  element.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-4px)" },
      { transform: "translateX(4px)" },
      { transform: "translateX(-2px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 250, easing: EASE },
  );
}

/**
 * A 16px tick in the status colour of done. With `draw` it draws itself in (300ms) when it
 * appears, for a decision that was just taken; without it, it is simply there.
 */
export function DrawnTick({ draw = false, className }: { draw?: boolean; className?: string }) {
  const path = useRef<SVGPathElement>(null);
  // Only the value it appeared with counts: a tick that is already there never draws again.
  const drawOnMount = useRef(draw);
  useEffect(() => {
    const element = path.current;
    if (!drawOnMount.current || !element || reducedMotion()) return;
    const length = element.getTotalLength();
    element.animate(
      [
        { strokeDasharray: `${length}`, strokeDashoffset: `${length}` },
        { strokeDasharray: `${length}`, strokeDashoffset: "0" },
      ],
      { duration: 300, easing: EASE },
    );
  }, []);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-(--icon) shrink-0 text-done", className)}
    >
      <path ref={path} d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * The keys whose value changed since the last render that saw them (a shot that was just
 * approved, a clip that just finished). Keys seen for the first time do not count, so nothing
 * plays when a page or a further page of rows first appears.
 */
export function useChangedKeys(
  entries: readonly (readonly [string, string])[],
): ReadonlySet<string> {
  const signature = entries.map(([key, value]) => `${key}=${value}`).join("|");
  const [seen, setSeen] = useState(signature);
  const [state, setState] = useState(() => ({
    known: new Map(entries),
    changed: new Set<string>() as ReadonlySet<string>,
  }));
  if (seen !== signature) {
    setSeen(signature);
    const changed = new Set<string>();
    for (const [key, value] of entries) {
      const before = state.known.get(key);
      if (before !== undefined && before !== value) changed.add(key);
    }
    const known = new Map(state.known);
    for (const [key, value] of entries) known.set(key, value);
    setState({ known, changed });
  }
  return state.changed;
}

/**
 * Status content that settles into its new state: when `settleKey` changes the content is
 * mounted again with the 250ms swap fade. `settle` false keeps the first appearance still.
 */
export function Settle({
  settleKey,
  settle,
  className,
  children,
}: {
  settleKey: string;
  settle: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span key={settleKey} className={cn("inline-flex min-w-0", settle && "swap-in", className)}>
      {children}
    </span>
  );
}
