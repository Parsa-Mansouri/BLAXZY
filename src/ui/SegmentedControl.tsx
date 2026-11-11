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
  /** Stretch to the container width with equal segments. */
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}

/** The macOS segmented control: a grey track with the chosen segment lifted. */
export function SegmentedControl({
  options,
  value,
  onValueChange,
  fullWidth = false,
  disabled,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps) {
  const thumbId = useId();
  return (
    <MotionConfig reducedMotion="user">
      <RadioGroup
        aria-label={ariaLabel}
        value={value}
        onValueChange={(next) => onValueChange(String(next))}
        disabled={disabled}
        className={cn(
          "inline-flex h-(--control-h) max-w-full rounded-capsule bg-elevated p-0.5",
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
                "relative inline-flex min-w-0 cursor-default items-center justify-center rounded-capsule px-4 text-secondary focus-ring select-none",
                fullWidth && "flex-1",
                selected ? "font-medium text-label" : "text-label-2 hover:text-label",
                "data-[disabled]:pointer-events-none data-[disabled]:text-label-3",
              )}
            >
              {selected ? (
                <motion.span
                  layoutId={thumbId}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-capsule bg-fill"
                  transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                />
              ) : null}
              <span className="relative inline-flex items-center gap-1.5 [&_svg]:size-(--icon-sm)">
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
