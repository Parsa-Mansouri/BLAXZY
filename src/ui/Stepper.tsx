"use client";

import { Fragment } from "react";
import { Check, Lock } from "lucide-react";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

export type StepStatus = "done" | "current" | "upcoming" | "locked";

export interface StepperStep {
  id: string;
  label: string;
  status: StepStatus;
  /** Why a locked step is locked (shown on hover/focus). */
  lockedHint?: string;
}

export interface StepperProps {
  steps: StepperStep[];
  /** Makes done and current steps clickable. */
  onStepClick?: (id: string) => void;
  /** Accessible name, e.g. "Film progress". */
  "aria-label"?: string;
  className?: string;
}

export function Stepper({
  steps,
  onStepClick,
  className,
  "aria-label": ariaLabel = "Progress",
}: StepperProps) {
  return (
    <nav aria-label={ariaLabel} className={className}>
      <ol className="flex w-full items-center">
        {steps.map((step, index) => {
          const clickable =
            Boolean(onStepClick) && (step.status === "done" || step.status === "current");
          const marker = (
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium tabular-nums",
                "transition-colors duration-(--duration-base)",
                step.status === "done" && "border-accent bg-accent text-on-accent",
                step.status === "current" && "border-accent bg-accent-soft text-accent-text",
                step.status === "upcoming" && "border-line-strong text-fg-muted",
                step.status === "locked" && "border-line text-fg-subtle",
              )}
            >
              {step.status === "done" ? (
                <Check aria-hidden="true" className="size-4" strokeWidth={3} />
              ) : step.status === "locked" ? (
                <Lock aria-hidden="true" className="size-3.5" />
              ) : (
                index + 1
              )}
            </span>
          );
          const label = (
            <span
              className={cn(
                "text-sm whitespace-nowrap",
                step.status === "current"
                  ? "block font-medium text-fg"
                  : "hidden text-fg-muted sm:block",
                step.status === "locked" && "text-fg-subtle",
              )}
            >
              {step.label}
              {step.status === "locked" ? <span className="sr-only"> (locked)</span> : null}
            </span>
          );
          const inner = (
            <>
              {marker}
              {label}
            </>
          );
          const itemClass = cn(
            "flex items-center gap-2.5 rounded-full py-1 pr-1",
            clickable && "focus-ring cursor-pointer hover:[&_span:last-child]:text-fg",
          );

          const item = clickable ? (
            <button type="button" onClick={() => onStepClick?.(step.id)} className={itemClass}>
              {inner}
            </button>
          ) : (
            <span
              className={cn(itemClass, step.status === "locked" && "cursor-not-allowed")}
              tabIndex={step.status === "locked" && step.lockedHint ? 0 : undefined}
            >
              {inner}
            </span>
          );

          return (
            <Fragment key={step.id}>
              <li
                aria-current={step.status === "current" ? "step" : undefined}
                className={cn("flex items-center", step.status === "current" && "min-w-0")}
              >
                {step.status === "locked" && step.lockedHint ? (
                  <Tooltip content={step.lockedHint}>{item}</Tooltip>
                ) : (
                  item
                )}
              </li>
              {index < steps.length - 1 ? (
                <li aria-hidden="true" className="mx-2 h-px min-w-3 flex-1 sm:mx-3">
                  <span
                    className={cn(
                      "block h-px w-full transition-colors duration-(--duration-slow)",
                      step.status === "done" ? "bg-accent" : "bg-line-strong",
                    )}
                  />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
