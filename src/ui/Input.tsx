"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { useFieldControl, useFieldInline } from "./Field";
import { fieldShape, fieldSurface, type FieldVariant } from "./styles";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /**
   * `form` (default): 44px, 12px corners. `toolbar`: 36px capsule. `line`: no box, one underline,
   * 28px text; for the big "working title" field.
   */
  variant?: FieldVariant;
  /** Content before the text, e.g. an icon. */
  leading?: ReactNode;
  /** Content after the text, e.g. a unit or a button. */
  trailing?: ReactNode;
  /** Classes for the outer box (layout). Use `inputClassName` for the element itself. */
  className?: string;
  inputClassName?: string;
}

/** A text field. Inside a GroupedListField it drops its box and fills the row. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { variant = "form", leading, trailing, className, inputClassName, id, disabled, ...rest },
  ref,
) {
  const control = useFieldControl({ id, disabled });
  const inline = useFieldInline();
  const line = variant === "line";
  return (
    <div
      className={cn(
        inline
          ? "flex w-full min-w-0 items-center gap-2 has-[:disabled]:text-label-3"
          : [fieldSurface, fieldShape[variant]],
        line && "gap-4",
        className,
      )}
    >
      {leading ? (
        <span className="shrink-0 text-label-2 [&_svg]:size-(--icon)">{leading}</span>
      ) : null}
      <input
        ref={ref}
        {...control}
        {...rest}
        className={cn(
          "min-w-0 flex-1 bg-transparent py-1 text-body text-inherit outline-none disabled:cursor-not-allowed",
          line && "py-0 text-heading-sm font-medium tracking-[-0.02em]",
          inputClassName,
        )}
      />
      {trailing ? (
        <span className="flex shrink-0 items-center text-label-2">{trailing}</span>
      ) : null}
    </div>
  );
});
