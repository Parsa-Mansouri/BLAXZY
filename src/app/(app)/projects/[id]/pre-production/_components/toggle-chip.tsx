import type { ButtonHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "@/ui";

/**
 * A pressed-or-not choice in a row of choices (what is wrong with a picture, "I'm not sure").
 * The chosen one carries the brand ring and a tick, never a white fill: white is the screen's one
 * main action. The kit has no toggle chip yet.
 */
export function ToggleChip({
  on,
  className,
  children,
  ...rest
}: { on: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed">) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        "inline-flex min-h-(--btn) press items-center gap-1.5 rounded-capsule border px-4 text-left text-secondary font-medium focus-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        on
          ? "border-brand bg-selected pl-3 text-label"
          : "border-outline text-label-2 hover:bg-fill-4 hover:text-label",
        className,
      )}
      {...rest}
    >
      {on ? (
        <Check aria-hidden="true" strokeWidth={1.5} className="size-(--icon) shrink-0 text-brand" />
      ) : null}
      {children}
    </button>
  );
}
