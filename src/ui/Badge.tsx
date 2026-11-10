import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
  /** Small coloured dot before the label (use instead of an icon for status). */
  dot?: boolean;
}

const tones: Record<BadgeTone, string> = {
  neutral: "bg-hover text-fg-muted",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "neutral", icon, dot = false, className, children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5",
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
