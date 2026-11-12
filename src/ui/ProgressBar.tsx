"use client";

import { useId, type ReactNode } from "react";
import { cn } from "./cn";

export interface ProgressBarProps {
  /** 0-100, or null for an indeterminate bar. */
  value: number | null;
  label?: ReactNode;
  /** Shows the percentage on the trailing side. */
  showValue?: boolean;
  /** Status colour for the fill; the brand colour otherwise. */
  tone?: "default" | "success" | "warning" | "danger";
  className?: string;
  "aria-label"?: string;
}

const fills = {
  default: "bg-brand",
  success: "bg-green",
  warning: "bg-orange",
  danger: "bg-red",
} as const;

/** A thin progress bar with the progressbar role; nothing is rendered for assistive tech only. */
export function ProgressBar({
  value,
  label,
  showValue = false,
  tone = "default",
  className,
  "aria-label": ariaLabel,
}: ProgressBarProps) {
  const labelId = useId();
  const percent = value === null ? null : Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? labelId : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent === null ? undefined : Math.round(percent)}
      aria-valuetext={percent === null ? undefined : `${Math.round(percent)}%`}
      className={cn("flex flex-col gap-1.5", className)}
    >
      {label || showValue ? (
        <div className="flex items-baseline justify-between gap-3 text-callout tabular-nums">
          {label ? (
            <span id={labelId} className="text-label">
              {label}
            </span>
          ) : (
            <span />
          )}
          {showValue && percent !== null ? (
            <span className="text-label-2 tabular-nums">{Math.round(percent)}%</span>
          ) : null}
        </div>
      ) : null}
      <div className="relative h-1 w-full overflow-hidden rounded-capsule bg-fill-3">
        <div
          style={percent === null ? undefined : { width: `${percent}%` }}
          className={cn(
            "h-full rounded-capsule transition-[width] duration-(--dur-tab) ease-out",
            fills[tone],
            percent === null &&
              "absolute inset-y-0 w-1/3 animate-indeterminate motion-reduce:animate-pulse",
          )}
        />
      </div>
    </div>
  );
}
