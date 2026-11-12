import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "success" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
  /** Small dot before the label. */
  dot?: boolean;
}

const tones: Record<BadgeTone, string> = {
  neutral: "bg-fill-3 text-label-2",
  success: "bg-green/15 text-green",
  warning: "bg-orange/15 text-orange",
  danger: "bg-red/15 text-red",
};

/**
 * A status tag. Only for real status the person acts on (failed, needs review), never
 * decoration, never a "new"/"sample" tag, and never beside a StatusLine that already says it.
 * Prefer a StatusLine; a Badge is for a dense list where a line does not fit.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "neutral", icon, dot = false, className, children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-capsule px-2.5 py-0.5 text-meta font-medium whitespace-nowrap tabular-nums [&_svg]:size-(--icon)",
        tones[tone],
        className,
      )}
      {...rest}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {icon}
      {children}
    </span>
  );
});
