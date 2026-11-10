"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { useFieldControl } from "./Field";
import { controlHeight, controlSurface, controlText, type ControlSize } from "./styles";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: ControlSize;
  /** Content before the text, e.g. an icon. */
  leading?: ReactNode;
  /** Content after the text, e.g. a unit or button. */
  trailing?: ReactNode;
  /** Classes for the outer box (layout). Use `inputClassName` for the element itself. */
  className?: string;
  inputClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "md", leading, trailing, className, inputClassName, id, disabled, ...rest },
  ref,
) {
  const control = useFieldControl({ id, disabled });
  return (
    <div className={cn(controlSurface, controlHeight[size], "px-3", className)}>
      {leading ? <span className="shrink-0 text-fg-subtle [&_svg]:size-4">{leading}</span> : null}
      <input
        ref={ref}
        {...control}
        {...rest}
        className={cn(
          "min-w-0 flex-1 bg-transparent py-2 text-fg outline-none disabled:cursor-not-allowed",
          controlText,
          inputClassName,
        )}
      />
      {trailing ? <span className="shrink-0 text-fg-subtle">{trailing}</span> : null}
    </div>
  );
});
