"use client";

import { useId, type ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { MotionConfig, motion } from "motion/react";
import { cn } from "./cn";

export interface SegmentedOption {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name of the group. */
  "aria-label": string;
  size?: "sm" | "md";
  /** Stretch to the container width with equal segments. */
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl({
  options,
  value,
  onValueChange,
  size = "md",
  fullWidth = false,
  disabled,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps) {
  const pillId = useId();
  return (
    <MotionConfig reducedMotion="user">
      <RadioGroup
        aria-label={ariaLabel}
        value={value}
        onValueChange={(next) => onValueChange(String(next))}
        disabled={disabled}
        className={cn(
          "inline-flex max-w-full gap-1 rounded-md border border-line bg-sunken p-1",
          fullWidth && "flex w-full",
          className,
        )}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Radio.Root
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className={cn(
                "relative inline-flex min-w-0 cursor-default items-center justify-center gap-2 rounded-sm font-medium focus-ring select-none",
                "transition-colors duration-(--duration-fast)",
                size === "sm" ? "h-8 px-3 text-sm" : "h-9 px-4 text-sm",
                fullWidth && "flex-1",
                selected ? "text-fg" : "text-fg-muted hover:text-fg",
                "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
              )}
            >
              {selected ? (
                <motion.span
                  layoutId={pillId}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-sm bg-raised shadow-xs ring-1 ring-line-strong"
                  transition={{ type: "spring", stiffness: 520, damping: 40 }}
                />
              ) : null}
              <span className="relative inline-flex items-center gap-2 [&_svg]:size-4">
                {option.icon}
                <span className="truncate">{option.label}</span>
              </span>
            </Radio.Root>
          );
        })}
      </RadioGroup>
    </MotionConfig>
  );
}
