"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "./cn";

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldControlProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
  required?: boolean;
  disabled?: boolean;
}

/** Controls call this to pick up id, aria wiring and state from the surrounding Field. */
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
  label: ReactNode;
  /** Always-visible helper line under the control. */
  hint?: ReactNode;
  /** Error message. Replaces nothing: shown below the hint and marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Shows "Optional" next to the label. Use instead of `required` for non-mandatory fields. */
  optional?: boolean;
  disabled?: boolean;
  /** Extra element aligned to the label row, e.g. a HelpTip. */
  labelAccessory?: ReactNode;
  className?: string;
  children: ReactNode;
}

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
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <FieldContext.Provider
      value={{
        id,
        describedBy: describedBy || undefined,
        invalid: Boolean(error),
        required,
        disabled,
      }}
    >
      <div className={cn("flex min-w-0 flex-col gap-2", className)}>
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="text-sm font-medium text-fg">
            {label}
            {required ? (
              <span aria-hidden="true" className="ml-0.5 text-accent-text">
                *
              </span>
            ) : null}
            {optional && !required ? (
              <span className="ml-2 text-xs font-normal text-fg-subtle">Optional</span>
            ) : null}
          </label>
          {labelAccessory}
        </div>
        {children}
        {hint ? (
          <p id={hintId} className="text-sm text-fg-subtle">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="mt-[3px] size-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
