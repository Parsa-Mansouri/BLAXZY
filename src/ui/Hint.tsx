import type { ReactNode } from "react";
import { cn } from "./cn";

export interface HintProps {
  children: ReactNode;
  /** `warning` sets the text in orange for a caution. */
  tone?: "default" | "warning";
  id?: string;
  className?: string;
}

/** Footnote text: quiet, always-visible help under a field, a group or a section. */
export function Hint({ children, tone = "default", id, className }: HintProps) {
  return (
    <p
      id={id}
      className={cn(
        "max-w-(--measure) text-callout",
        tone === "warning" ? "text-orange" : "text-label-2",
        className,
      )}
    >
      {children}
    </p>
  );
}
