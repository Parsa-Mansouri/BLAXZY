"use client";

import { useState, type FocusEvent, type ReactNode } from "react";
import { cn } from "./cn";
import { DemoHint } from "./DemoHint";
import { TypingScene } from "./demo-scenes";
import type { TypingOptions } from "./demo-hint-text";
import type { FieldVariant } from "./styles";

export interface AnimatedPlaceholderProps {
  /** The field: one Input, Textarea, <input> or <textarea>. Keep its `placeholder` = `lines[0]`. */
  children: ReactNode;
  /**
   * Example entries, typed, held and erased in turn. The first is the field's real placeholder:
   * the animation ends on it, and it is all reduced motion shows.
   */
  lines: readonly string[];
  /** True while the field has no value. The animation shows only when empty and not focused. */
  empty: boolean;
  /** Hides the animation (a disabled field keeps its plain placeholder). */
  disabled?: boolean;
  /**
   * Lines up the text with an Input of this variant (`form` by default). `custom`: no offsets
   * or type; give them in `overlayClassName` to match the field's padding and font exactly.
   */
  variant?: FieldVariant | "custom";
  /** Wraps long lines (a textarea) instead of keeping them on one clipped line. */
  multiline?: boolean;
  /** Classes for the wrapper round the field (layout). */
  className?: string;
  /** Classes for the text box over the field: offsets, type and colour. */
  overlayClassName?: string;
  /** Milliseconds before the first pass, to stagger it after other hints. */
  delay?: number;
  timing?: TypingOptions;
}

/**
 * Where the text of an Input sits, per variant: inside its 1px border and side padding, in its
 * type and placeholder colour (label-3). The line variant's text is centred above its 12px
 * bottom padding.
 */
const fit: Record<FieldVariant, string> = {
  form: "inset-y-px inset-x-[calc(0.875rem+1px)] text-body text-label-3",
  toolbar: "inset-y-px inset-x-[calc(1rem+1px)] text-body text-label-3",
  line: "inset-x-0 top-0 bottom-[calc(0.75rem+1px)] text-heading-sm font-medium tracking-[-0.02em] text-label-3",
};

/**
 * A placeholder that shows what to write: example entries are typed into the empty field, held
 * and erased, ending on the field's real placeholder (a demo hint, see "Demo hints" in the UI
 * README). Wrap the field; keep its native `placeholder` (screen readers, no JavaScript, and what
 * shows while it has focus):
 *
 *   <AnimatedPlaceholder lines={["Night Ferry", "Salt"]} empty={!title}>
 *     <Input placeholder="Night Ferry" value={title} onChange={...} />
 *   </AnimatedPlaceholder>
 *
 * It plays one pass when the field first comes into view and then rests on the first line. While
 * it plays, the native placeholder is hidden; focusing the field hides the animation and brings
 * the native placeholder back. Reduced motion shows the first line only, like a plain placeholder.
 */
export function AnimatedPlaceholder({
  children,
  lines,
  empty,
  disabled = false,
  variant = "form",
  multiline = false,
  className,
  overlayClassName,
  delay,
  timing,
}: AnimatedPlaceholderProps) {
  const [focused, setFocused] = useState(false);
  const isField = (event: FocusEvent) =>
    event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;

  return (
    <div
      className={cn("demo-placeholder-host", className)}
      onFocus={(event) => {
        if (isField(event)) setFocused(true);
      }}
      onBlur={(event) => {
        if (isField(event)) setFocused(false);
      }}
    >
      {children}
      <span
        aria-hidden="true"
        className={cn("demo-placeholder", variant !== "custom" && fit[variant], overlayClassName)}
        data-on={empty && !focused && !disabled ? "" : undefined}
        data-multiline={multiline ? "" : undefined}
      >
        <DemoHint mask="none" delay={delay}>
          <TypingScene lines={lines} timing={timing} font="inherit" />
        </DemoHint>
      </span>
    </div>
  );
}
