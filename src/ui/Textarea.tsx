"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";
import { useFieldControl } from "./Field";
import { fieldSurface } from "./styles";
import { mergeRefs } from "./utils";

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> {
  /** Rows shown when empty. */
  minRows?: number;
  /** Stops growing after this many rows and scrolls. */
  maxRows?: number;
  /** `reading` 15/22 (default). `script` sets the larger 17/24 text for long free answers. */
  textStyle?: "reading" | "script";
}

/** Multi-line text that grows with its content. Works controlled and uncontrolled. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    minRows = 3,
    maxRows = 12,
    textStyle = "reading",
    className,
    id,
    disabled,
    onChange,
    value,
    ...rest
  },
  ref,
) {
  const control = useFieldControl({ id, disabled });
  const inner = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = inner.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 20;
    const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    el.style.height = "auto";
    const max = line * maxRows + pad;
    const min = line * minRows + pad;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [minRows, maxRows]);

  useEffect(() => {
    resize();
  }, [resize, value]);

  useEffect(() => {
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  return (
    <div className={cn(fieldSurface, "items-stretch rounded-field px-3.5", className)}>
      <textarea
        ref={mergeRefs(ref, inner)}
        {...control}
        {...rest}
        value={value}
        rows={minRows}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          onChange?.(event);
          resize();
        }}
        className={cn(
          "min-w-0 flex-1 resize-none bg-transparent py-2.5 text-label outline-none disabled:cursor-not-allowed",
          textStyle === "script" ? "text-row leading-6 font-regular" : "text-body",
        )}
      />
    </div>
  );
});
