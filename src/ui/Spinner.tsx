import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: "sm" | "md" | "lg";
  /** Accessible name announced to screen readers. */
  label?: string;
}

const sizes = { sm: "size-(--icon-sm)", md: "size-(--icon)", lg: "size-8" } as const;

const SPOKES = 8;

/** Apple's activity indicator: eight spokes stepping round. Static under reduced motion. */
export function Spinner({ size = "md", label = "Loading", className, ...rest }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={cn("inline-flex", className)} {...rest}>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={cn("animate-spin motion-reduce:animate-none", sizes[size])}
      >
        {Array.from({ length: SPOKES }, (_, i) => (
          <rect
            key={i}
            x="11"
            y="2"
            width="2"
            height="6"
            rx="1"
            fill="currentColor"
            opacity={0.25 + (0.75 * (SPOKES - i)) / SPOKES}
            transform={`rotate(${(-360 / SPOKES) * i} 12 12)`}
          />
        ))}
      </svg>
    </span>
  );
}
