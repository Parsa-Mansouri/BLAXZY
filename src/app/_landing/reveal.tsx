"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/ui";

export interface RevealProps {
  children: ReactNode;
  /** `block` fades the wrapper in; `group` only releases the entrances inside it (enter, rise, rule-in). */
  mode?: "block" | "group";
  className?: string;
  style?: CSSProperties;
}

/**
 * Adds `data-in` the first time the wrapper scrolls into view. It hides nothing until it has
 * mounted (`data-reveal-ready`), so the page reads fine without scripts, and under reduced motion
 * everything shows at once.
 */
export function Reveal({ children, mode = "block", className, style }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.dataset.in = "";
      return;
    }
    el.dataset.revealReady = "";
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          el.dataset.in = "";
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(mode === "block" ? "reveal" : "reveal-group", className)}
      style={style}
    >
      {children}
    </div>
  );
}
