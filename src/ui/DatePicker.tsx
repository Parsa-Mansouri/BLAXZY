"use client";

import { useState } from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { CalendarDays } from "lucide-react";
import { Calendar } from "./Calendar";
import { clampISO, formatDate, isValidISO, todayISO, type WeekStart } from "./date-math";
import { Button } from "./Button";
import { cn } from "./cn";
import { useFieldControl } from "./Field";
import { fieldShape, fieldSurface, popupSurface, type FieldVariant } from "./styles";

export interface DatePickerProps {
  /** ISO `YYYY-MM-DD` or null. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Earliest selectable ISO date. */
  min?: string;
  /** Latest selectable ISO date. */
  max?: string;
  placeholder?: string;
  /** Show a Clear action. */
  clearable?: boolean;
  weekStart?: WeekStart;
  locale?: string;
  /** `form` (default) or `toolbar` shape. */
  variant?: FieldVariant;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

export function DatePicker({
  value,
  onValueChange,
  min,
  max,
  placeholder = "Choose a Date",
  clearable = false,
  weekStart = 1,
  locale,
  variant = "form",
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const control = useFieldControl({ id, disabled });
  const [open, setOpen] = useState(false);
  const valid = isValidISO(value) ? value : null;
  const today = todayISO();
  const todayAllowed = clampISO(today, min, max) === today;

  return (
    <BasePopover.Root open={open} onOpenChange={setOpen}>
      <BasePopover.Trigger
        id={control.id}
        disabled={control.disabled}
        aria-label={ariaLabel}
        aria-describedby={control["aria-describedby"]}
        aria-invalid={control["aria-invalid"]}
        className={cn(
          fieldSurface,
          fieldShape[variant],
          "cursor-default justify-between py-1 text-left text-body focus-ring outline-none",
          "aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-red aria-[invalid=true]:ring-inset",
          className,
        )}
      >
        <span className={cn("truncate", valid ? "text-label" : "text-label-2")}>
          {valid ? formatDate(valid, locale) : placeholder}
        </span>
        <CalendarDays aria-hidden="true" className="size-(--icon) shrink-0 text-label-2" />
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-(--z-popover)"
        >
          <BasePopover.Popup
            aria-label="Choose a date"
            initialFocus={(): HTMLElement | null =>
              document.querySelector<HTMLElement>('[role="grid"] button[tabindex="0"]')
            }
            className={cn(popupSurface, "p-3")}
          >
            <Calendar
              autoFocus
              value={valid}
              min={min}
              max={max}
              weekStart={weekStart}
              locale={locale}
              onValueChange={(iso) => {
                onValueChange(iso);
                setOpen(false);
              }}
            />
            <div className="mt-2 flex items-center justify-between pt-2 hairline-t">
              <Button
                variant="plain"
                disabled={!todayAllowed}
                onClick={() => {
                  onValueChange(today);
                  setOpen(false);
                }}
              >
                Today
              </Button>
              {clearable && valid ? (
                <Button
                  variant="plain"
                  onClick={() => {
                    onValueChange(null);
                    setOpen(false);
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
