"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  addMonths,
  buildMonthGrid,
  clampISO,
  endOfWeek,
  formatDate,
  formatMonthYear,
  isOutOfRange,
  parseISO,
  startOfWeek,
  todayISO,
  weekdayLabels,
  type WeekStart,
} from "./date-math";
import { cn } from "./cn";
import { IconButton } from "./Button";

export interface CalendarProps {
  /** Selected ISO date or null. */
  value: string | null;
  onValueChange: (iso: string) => void;
  min?: string;
  max?: string;
  weekStart?: WeekStart;
  locale?: string;
  /** Move focus into the grid on mount (used inside popovers). */
  autoFocus?: boolean;
  className?: string;
}

export function Calendar({
  value,
  onValueChange,
  min,
  max,
  weekStart = 1,
  locale,
  autoFocus = false,
  className,
}: CalendarProps) {
  const today = todayISO();
  const start = clampISO(value && parseISO(value) ? value : today, min, max);
  const [active, setActive] = useState(start);
  const gridRef = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(autoFocus);

  const view = parseISO(active) ?? parseISO(today)!;
  const weeks = buildMonthGrid(view.year, view.month, weekStart);
  const labels = weekdayLabels(weekStart, locale, "short");

  useEffect(() => {
    if (!shouldFocus.current) return;
    gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [active]);

  function moveTo(next: string) {
    const clamped = clampISO(next, min, max);
    shouldFocus.current = true;
    setActive(clamped);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const map: Record<string, string | undefined> = {
      ArrowLeft: addDays(active, -1),
      ArrowRight: addDays(active, 1),
      ArrowUp: addDays(active, -7),
      ArrowDown: addDays(active, 7),
      Home: startOfWeek(active, weekStart),
      End: endOfWeek(active, weekStart),
      PageUp: addMonths(active, event.shiftKey ? -12 : -1),
      PageDown: addMonths(active, event.shiftKey ? 12 : 1),
    };
    const next = map[event.key];
    if (!next) return;
    event.preventDefault();
    moveTo(next);
  }

  const prevMonth = addMonths(active, -1);
  const nextMonth = addMonths(active, 1);
  const canPrev = !min || endOfMonthISO(prevMonth) >= min;
  const canNext = !max || startOfMonthISO(nextMonth) <= max;

  return (
    <div className={cn("w-[19.5rem] max-w-full select-none", className)}>
      <div className="mb-3 flex items-center justify-between">
        <IconButton
          label="Previous month"
          size="sm"
          icon={<ChevronLeft />}
          disabled={!canPrev}
          onClick={() => moveTo(prevMonth)}
        />
        <div aria-live="polite" className="text-sm font-medium text-fg">
          {formatMonthYear(view.year, view.month, locale)}
        </div>
        <IconButton
          label="Next month"
          size="sm"
          icon={<ChevronRight />}
          disabled={!canNext}
          onClick={() => moveTo(nextMonth)}
        />
      </div>
      <div
        role="grid"
        aria-label={formatMonthYear(view.year, view.month, locale)}
        ref={gridRef}
        onKeyDown={onKeyDown}
      >
        <div role="row" className="grid grid-cols-7">
          {labels.map((label) => (
            <div
              key={label}
              role="columnheader"
              className="flex h-8 items-center justify-center text-xs text-fg-subtle"
            >
              {label}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div role="row" key={week[0]!.iso} className="grid grid-cols-7">
            {week.map((day) => {
              const selected = day.iso === value;
              const disabled = isOutOfRange(day.iso, min, max);
              const isToday = day.iso === today;
              return (
                <div
                  role="gridcell"
                  key={day.iso}
                  aria-selected={selected}
                  className="flex justify-center"
                >
                  <button
                    type="button"
                    tabIndex={day.iso === active ? 0 : -1}
                    disabled={disabled}
                    aria-label={formatDate(day.iso, locale, { weekday: "long" })}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => onValueChange(day.iso)}
                    onFocus={() => {
                      if (day.iso !== active) setActive(day.iso);
                    }}
                    className={cn(
                      "relative flex size-10 items-center justify-center rounded-full text-sm tabular-nums focus-ring",
                      "transition-colors duration-(--duration-fast)",
                      day.inMonth ? "text-fg" : "text-fg-subtle",
                      !selected && !disabled && "hover:bg-hover",
                      selected && "bg-accent font-medium text-on-accent hover:bg-accent-hover",
                      disabled && "cursor-not-allowed opacity-30",
                    )}
                  >
                    {day.day}
                    {isToday ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute bottom-1.5 size-1 rounded-full",
                          selected ? "bg-on-accent" : "bg-accent",
                        )}
                      />
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function startOfMonthISO(iso: string): string {
  return `${iso.slice(0, 8)}01`;
}

function endOfMonthISO(iso: string): string {
  return addDays(startOfMonthISO(addMonths(iso, 1)), -1);
}
