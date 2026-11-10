"use client";

import { useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from "react";
import { cn } from "./cn";
import { clampDuration, joinDuration, splitDuration } from "./duration";
import { useFieldControl } from "./Field";
import { fieldShape, fieldSurface, type FieldVariant } from "./styles";

export interface DurationInputProps {
  /** Total seconds, or null when empty. */
  value: number | null;
  onValueChange: (seconds: number | null) => void;
  /** Smallest allowed total, in seconds. */
  min?: number;
  /** Largest allowed total, in seconds. */
  max?: number;
  /** `form` (default) or `toolbar` shape. */
  variant?: FieldVariant;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

interface Draft {
  minutes: string;
  seconds: string;
}

const digits = (text: string) => text.replace(/\D/g, "").slice(0, 4);

export function DurationInput({
  value,
  onValueChange,
  min,
  max,
  variant = "form",
  disabled,
  id,
  className,
  "aria-label": ariaLabel = "Duration",
}: DurationInputProps) {
  const control = useFieldControl({ id, disabled });
  const [draft, setDraft] = useState<Draft | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  const parts = value === null ? null : splitDuration(value);
  const shown: Draft = draft ?? {
    minutes: parts ? String(parts.minutes) : "",
    seconds: parts ? String(parts.seconds) : "",
  };

  function commit(next: Draft) {
    setDraft(next);
    if (next.minutes === "" && next.seconds === "") {
      onValueChange(null);
      return;
    }
    onValueChange(
      clampDuration(
        joinDuration(Number(next.minutes || 0), Number(next.seconds || 0)),
        undefined,
        max,
      ),
    );
  }

  function step(field: keyof Draft, delta: number) {
    const current = value ?? 0;
    const next = clampDuration(current + (field === "minutes" ? delta * 60 : delta), min ?? 0, max);
    setDraft(null);
    onValueChange(next);
  }

  function onKeyDown(field: keyof Draft) {
    return (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        step(field, event.key === "ArrowUp" ? 1 : -1);
      }
    };
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (groupRef.current?.contains(event.relatedTarget as Node | null)) return;
    setDraft(null);
    if (value !== null && min !== undefined && value < min) onValueChange(min);
  }

  const field = (name: keyof Draft, unit: string, first: boolean) => (
    <label className="flex flex-1 items-center gap-2">
      <input
        id={first ? control.id : undefined}
        inputMode="numeric"
        autoComplete="off"
        disabled={control.disabled}
        aria-label={`${ariaLabel}, ${name}`}
        aria-describedby={control["aria-describedby"]}
        aria-invalid={control["aria-invalid"]}
        value={shown[name]}
        placeholder="0"
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          commit({ ...shown, [name]: digits(event.target.value) })
        }
        onKeyDown={onKeyDown(name)}
        onFocus={(event) => event.currentTarget.select()}
        className={cn(
          "w-full min-w-0 bg-transparent py-1 text-right text-body text-label tabular-nums outline-none disabled:cursor-not-allowed",
        )}
      />
      <span className="text-body text-label-2">{unit}</span>
    </label>
  );

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={ariaLabel}
      onBlur={onBlur}
      className={cn(
        fieldSurface,
        fieldShape[variant],
        "w-auto max-w-full gap-4 sm:max-w-72",
        className,
      )}
    >
      {field("minutes", "min", true)}
      <span aria-hidden="true" className="h-4 w-(--hairline) bg-separator" />
      {field("seconds", "sec", false)}
    </div>
  );
}
