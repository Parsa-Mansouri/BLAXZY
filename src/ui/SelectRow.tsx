"use client";

import { forwardRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { cn } from "./cn";
import { Tick } from "./Feedback";

export interface SelectRowProps extends Omit<
  React.ComponentPropsWithoutRef<"button">,
  "children" | "value"
> {
  /** What the row is: "Look", "INT. LIGHTHOUSE - NIGHT", "Mara". */
  label: ReactNode;
  /**
   * The answer, once there is one. Unanswered rows show only the label (17px, secondary);
   * answered rows show the label small (13px) above the value (17px, white).
   */
  value?: ReactNode;
  /** The row being shown in the focus area: its fill wipes in from the left. */
  active?: boolean;
  /** A brand tick at the trailing end that draws in when the row becomes done. */
  done?: boolean;
  /** Trailing content instead of the tick, e.g. a comment count or a StatusDot. */
  trailing?: ReactNode;
  /** `regular` 15px label, 56px tall (scenes). `large` 17px label, 60px tall (questions). */
  size?: "regular" | "large";
  /** Render as another element, e.g. `render={<Link href="?scene=2" />}`. */
  render?: ReactElement;
  /** For `stagger(i)` with `className="enter"`. */
  style?: CSSProperties;
}

/**
 * A selectable row for the list in a FocusLayout. Selected rows get `aria-current` and a fill
 * that wipes in from the left; colour changes take 150ms.
 */
export const SelectRow = forwardRef<HTMLElement, SelectRowProps>(function SelectRow(
  {
    label,
    value,
    active = false,
    done = false,
    trailing,
    size = "large",
    render,
    className,
    type,
    ...rest
  },
  ref,
) {
  const answered = value !== undefined && value !== null && value !== "";
  const props = mergeProps<"button">(
    {
      type: render ? undefined : (type ?? "button"),
      "aria-current": active ? "true" : undefined,
      className: cn(
        "row-wipe press flex w-full items-center gap-3 rounded-row px-3.5 py-2.5 text-left focus-ring",
        size === "large" ? "min-h-15" : "min-h-14",
        active ? "text-label" : "text-label-2 hover:bg-fill-4",
        className,
      ),
      children: (
        <>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            {answered ? (
              <>
                <span className="text-meta text-label-2">{label}</span>
                <span className="text-row break-words text-label">{value}</span>
              </>
            ) : (
              <span
                className={cn(
                  "font-medium break-words transition-colors duration-(--dur-press)",
                  size === "large" ? "text-row" : "text-body",
                )}
              >
                {label}
              </span>
            )}
          </span>
          {trailing !== undefined ? (
            <span className="shrink-0 text-meta text-label-2 tabular-nums">{trailing}</span>
          ) : done ? (
            <>
              {/* Mounted when the row becomes done, so the brand tick draws in then. */}
              <Tick />
              <span className="sr-only">, done</span>
            </>
          ) : null}
        </>
      ),
    },
    rest,
  );
  return useRender({ defaultTagName: "button", render: render ?? <button />, ref, props });
});
