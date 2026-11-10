import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: "sm" | "md" | "lg";
  /** Accessible name announced to screen readers. */
  label?: string;
}

const sizes = { sm: "size-4", md: "size-5", lg: "size-8" } as const;

export function Spinner({ size = "md", label = "Loading", className, ...rest }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={cn("inline-flex", className)} {...rest}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className={cn("animate-spin-slow", sizes[size])}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
