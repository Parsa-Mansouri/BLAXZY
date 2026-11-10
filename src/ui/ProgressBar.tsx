"use client";

import type { ReactNode } from "react";
import { Progress } from "@base-ui/react/progress";
import { cn } from "./cn";

export interface ProgressBarProps {
  /** 0-100, or null for an indeterminate bar. */
  value: number | null;
  label?: ReactNode;
  /** Shows the percentage on the right. */
  showValue?: boolean;
  tone?: "accent" | "success" | "warning" | "danger";
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

const fills = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

export function ProgressBar({
  value,
  label,
  showValue = false,
  tone = "accent",
  size = "md",
  className,
  "aria-label": ariaLabel,
}: ProgressBarProps) {
  return (
    <Progress.Root
      value={value}
      aria-label={label ? undefined : ariaLabel}
      className={cn("flex flex-col gap-2", className)}
    >
      {label || showValue ? (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          {label ? <Progress.Label className="text-fg">{label}</Progress.Label> : <span />}
          {showValue && value !== null ? (
            <span className="text-fg-muted tabular-nums">{Math.round(value)}%</span>
          ) : null}
        </div>
      ) : null}
      <Progress.Track
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-hover",
          size === "sm" ? "h-1.5" : "h-2.5",
        )}
      >
        <Progress.Indicator
          className={cn(
            "rounded-full transition-[width] duration-(--duration-slow) ease-(--ease-out)",
            fills[tone],
            value === null &&
              "absolute inset-y-0 w-1/3 animate-shimmer bg-[linear-gradient(90deg,transparent,var(--fg),transparent)] opacity-40",
          )}
        />
      </Progress.Track>
    </Progress.Root>
  );
}
