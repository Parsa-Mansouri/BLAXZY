"use client";

import { useState } from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { CalendarDays } from "lucide-react";
import { Calendar } from "./Calendar";
import { clampISO, formatDate, isValidISO, todayISO, type WeekStart } from "./date-math";
import { Button } from "./Button";
import { cn } from "./cn";
import { useFieldControl } from "./Field";
import {
  controlHeight,
  controlSurface,
  controlText,
  popupSurface,
  type ControlSize,
} from "./styles";

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
  size?: ControlSize;
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
  placeholder = "Pick a date",
  clearable = false,
  weekStart = 1,
  locale,
  size = "md",
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
          controlSurface,
          controlHeight[size],
          controlText,
          "cursor-default justify-between px-3 py-2 text-left outline-none data-[popup-open]:border-focus",
          className,
        )}
      >
        <span className={cn("truncate", valid ? "text-fg" : "text-fg-subtle")}>
          {valid ? formatDate(valid, locale) : placeholder}
        </span>
        <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-(--z-popover)"
        >
          <BasePopover.Popup
            aria-label="Choose a date"
            initialFocus={(): HTMLElement | null =>
              document.querySelector<HTMLElement>('[role="grid"] button[tabindex="0"]')
            }
            className={cn(popupSurface, "p-4")}
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
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
              <Button
                size="sm"
                variant="ghost"
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
                  size="sm"
                  variant="ghost"
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
