"use client";

import type { ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { cn } from "./cn";

export interface ChoiceOption {
  value: string;
  /** Label under the thumbnail. */
  title: string;
  /** Optional second line under the label. */
  description?: string;
  /** Drawn picture of the choice. Takes precedence over `icon`. */
  thumbnail?: ReactNode;
  /** Shown centred in the thumbnail when there is no drawing. */
  icon?: ReactNode;
  disabled?: boolean;
}

export interface ChoiceCardsProps {
  options: ChoiceOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  /** Accessible name of the group (the question being asked). */
  "aria-label": string;
  /** Thumbnail shape. Defaults to 4:3. */
  aspect?: "video" | "standard" | "square";
  disabled?: boolean;
  className?: string;
}

const aspects = {
  video: "aspect-video",
  standard: "aspect-[4/3]",
  square: "aspect-square",
} as const;

/**
 * Option thumbnails, as in System Settings > Appearance: a picture of each choice with its label
 * beneath and a brand ring around the chosen one. Arrow keys move between options.
 */
export function ChoiceCards({
  options,
  value,
  onValueChange,
  aspect = "standard",
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
      className={cn("flex flex-wrap gap-x-5 gap-y-4", className)}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            "group flex w-(--thumb-w) cursor-default flex-col items-center gap-2 rounded-artwork text-center outline-none select-none",
            "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus",
            "data-[disabled]:pointer-events-none data-[disabled]:text-label-3",
          )}
        >
          <span
            className={cn(
              "flex w-full items-center justify-center overflow-hidden rounded-field bg-elevated text-label-2",
              "transition-[box-shadow,color] duration-(--dur-fast)",
              "group-hover:text-label group-data-[checked]:text-label",
              "group-data-[checked]:ring-2 group-data-[checked]:ring-brand group-data-[checked]:ring-offset-2 group-data-[checked]:ring-offset-ground",
              "[&>svg]:size-(--icon-lg)",
              aspects[aspect],
            )}
          >
            {option.thumbnail ?? option.icon}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-body text-label group-data-[checked]:font-semibold">
              {option.title}
            </span>
            {option.description ? (
              <span className="text-callout text-label-2">{option.description}</span>
            ) : null}
          </span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
