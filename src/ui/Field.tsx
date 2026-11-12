"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "./cn";

export interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
  /** True inside a grouped-list row: controls drop their own fill and fill the row. */
  inline: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export const FieldProvider = FieldContext.Provider;

/** Whether the nearest field is a grouped-list row (controls render bare). */
export function useFieldInline(): boolean {
  return useContext(FieldContext)?.inline ?? false;
}

export interface FieldControlProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
  required?: boolean;
  disabled?: boolean;
}

/** Controls call this to pick up id, aria wiring and state from the surrounding field. */
export function useFieldControl(own: { id?: string; disabled?: boolean } = {}): FieldControlProps {
  const ctx = useContext(FieldContext);
  if (!ctx) return { id: own.id, disabled: own.disabled };
  return {
    id: own.id ?? ctx.id,
    "aria-describedby": ctx.describedBy,
    "aria-invalid": ctx.invalid ? true : undefined,
    "aria-required": ctx.required ? true : undefined,
    disabled: own.disabled ?? (ctx.disabled || undefined),
  };
}

export interface FieldProps {
  /** Persistent label above the control. */
  label: ReactNode;
  /** Help text under the control. */
  hint?: ReactNode;
  /** What is wrong and how to fix it. Marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Shows "Optional" after the label. */
  optional?: boolean;
  disabled?: boolean;
  /** Extra element on the label row, e.g. a HelpTip. */
  labelAccessory?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * A stacked form field: label, control, then the error (red) and the help text. When an error
 * appears the control shakes once (300ms) and the message fades in.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  disabled = false,
  labelAccessory,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <FieldProvider
      value={{
        id,
        describedBy: describedBy || undefined,
        invalid: Boolean(error),
        required,
        disabled,
        inline: false,
      }}
    >
      <div className={cn("flex min-w-0 flex-col gap-2", className)}>
        <div className="flex items-center gap-1.5">
          <label htmlFor={id} className="text-secondary text-label-2">
            {label}
            {optional && !required ? <span className="ml-1.5 text-label-2">Optional</span> : null}
          </label>
          {labelAccessory}
        </div>
        {/* The control gives a short shake when it is marked wrong (off under reduced motion). */}
        <div className={cn("min-w-0", error ? "shake" : null)}>{children}</div>
        {error ? (
          <p id={errorId} role="alert" className="pop-in text-secondary text-red">
            {error}
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-secondary text-label-2">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldProvider>
  );
}
