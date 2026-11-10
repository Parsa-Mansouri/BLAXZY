"use client";

import type { ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check } from "lucide-react";
import { cn } from "./cn";

export interface ChoiceOption {
  value: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface ChoiceCardsProps {
  options: ChoiceOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  /** Accessible name of the group (e.g. the question being asked). */
  "aria-label": string;
  /** Columns from the `sm` breakpoint up. Always one column on phones. */
  columns?: 1 | 2 | 3;
  disabled?: boolean;
  className?: string;
}

const columnClass = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" } as const;

/** Large tappable cards: the way the Wizard asks one question at a time. */
export function ChoiceCards({
  options,
  value,
  onValueChange,
  columns = 2,
  disabled,
  className,
  "aria-label": ariaLabel,
}: ChoiceCardsProps) {
  return (
    <RadioGroup
      aria-label={ariaLabel}
      value={value ?? ""}
      onValueChange={(next) => onValueChange(String(next))}
      disabled={disabled}
      className={cn("grid grid-cols-1 gap-3", columnClass[columns], className)}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            "group relative flex min-h-28 cursor-default flex-col items-start gap-3 rounded-lg border border-line-strong bg-surface p-5 text-left focus-ring select-none",
            "transition-[background-color,border-color,box-shadow,scale] duration-(--duration-base) ease-(--ease-out)",
            "hover:border-fg-subtle hover:bg-raised active:scale-[0.99]",
            "data-[checked]:border-accent data-[checked]:bg-accent-soft data-[checked]:shadow-[0_0_0_1px_var(--accent)]",
            "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[disabled]:hover:border-line-strong",
          )}
        >
          <span className="flex w-full items-start justify-between gap-3">
            {option.icon ? (
              <span className="flex size-11 items-center justify-center rounded-md bg-sunken text-fg-muted transition-colors group-data-[checked]:bg-accent group-data-[checked]:text-on-accent [&_svg]:size-5">
                {option.icon}
              </span>
            ) : (
              <span />
            )}
            <span
              aria-hidden="true"
              className="flex size-6 items-center justify-center rounded-full border border-line-strong text-transparent transition-colors group-data-[checked]:border-accent group-data-[checked]:bg-accent group-data-[checked]:text-on-accent"
            >
              <Check className="size-3.5" strokeWidth={3} />
            </span>
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-base font-medium text-fg">{option.title}</span>
            {option.description ? (
              <span className="text-sm text-fg-muted">{option.description}</span>
            ) : null}
          </span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
