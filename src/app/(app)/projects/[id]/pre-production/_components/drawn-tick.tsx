"use client";

import { useEffect, useState } from "react";
import { cn } from "@/ui";

/**
 * A tick that draws itself in (250ms, the app's curve) when it appears: the confirmation that a
 * decision was saved. The global reduced-motion rule makes the transition instant.
 */
export function DrawnTick({ className }: { className?: string }) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-(--icon) shrink-0", className)}
    >
      <path
        d="M3 8.5l3.2 3.2L13 4.8"
        pathLength={1}
        style={{
          strokeDasharray: 1,
          strokeDashoffset: drawn ? 0 : 1,
          transition: "stroke-dashoffset var(--dur-swap) var(--ease-curve)",
        }}
      />
    </svg>
  );
}
