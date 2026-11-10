"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { useFieldControl, useFieldInline } from "./Field";
import { fieldShape, fieldSurface, type FieldVariant } from "./styles";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** `form` (default): 10px corners, large height. `toolbar`: 6px corners, regular height. */
  variant?: FieldVariant;
  /** Content before the text, e.g. an icon. */
  leading?: ReactNode;
  /** Content after the text, e.g. a unit or a button. */
  trailing?: ReactNode;
  /** Classes for the outer box (layout). Use `inputClassName` for the element itself. */
  className?: string;
  inputClassName?: string;
}

/** A text field. Inside a GroupedListField it drops its fill and fills the row. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { variant = "form", leading, trailing, className, inputClassName, id, disabled, ...rest },
  ref,
) {
  const control = useFieldControl({ id, disabled });
  const inline = useFieldInline();
  return (
    <div
      className={cn(
        inline
          ? "flex w-full min-w-0 items-center gap-2 has-[:disabled]:opacity-60"
          : [fieldSurface, fieldShape[variant]],
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
          "min-w-0 flex-1 bg-transparent py-1 text-body text-label outline-none disabled:cursor-not-allowed",
          inputClassName,
        )}
      />
      {trailing ? (
        <span className="flex shrink-0 items-center text-label-2">{trailing}</span>
      ) : null}
    </div>
  );
});
