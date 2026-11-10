"use client";

import type { ReactNode } from "react";
import { Progress } from "@base-ui/react/progress";
import { cn } from "./cn";

export interface ProgressBarProps {
  /** 0-100, or null for an indeterminate bar. */
  value: number | null;
  label?: ReactNode;
  /** Shows the percentage on the trailing side. */
  showValue?: boolean;
  /** Status colour for the fill; white otherwise. */
  tone?: "default" | "success" | "warning" | "danger";
  className?: string;
  "aria-label"?: string;
}

const fills = {
  default: "bg-accent",
  success: "bg-green",
  warning: "bg-orange",
  danger: "bg-red",
} as const;

export function ProgressBar({
  value,
  label,
  showValue = false,
  tone = "default",
  className,
  "aria-label": ariaLabel,
}: ProgressBarProps) {
  return (
    <Progress.Root
      value={value}
      aria-label={label ? undefined : ariaLabel}
      className={cn("flex flex-col gap-1.5", className)}
    >
      {label || showValue ? (
        <div className="flex items-baseline justify-between gap-3 text-callout">
          {label ? <Progress.Label className="text-label">{label}</Progress.Label> : <span />}
          {showValue && value !== null ? (
            <span className="text-label-2 tabular-nums">{Math.round(value)}%</span>
          ) : null}
        </div>
      ) : null}
      <Progress.Track className="relative h-1 w-full overflow-hidden rounded-capsule bg-fill-3">
        <Progress.Indicator
          className={cn(
            "rounded-capsule transition-[width] duration-(--dur-base) ease-out",
            fills[tone],
            value === null &&
              "absolute inset-y-0 w-1/3 animate-indeterminate motion-reduce:animate-pulse",
          )}
        />
      </Progress.Track>
    </Progress.Root>
  );
}
