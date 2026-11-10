import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** "raised" sits one level above "default"; "outline" has no fill. */
  variant?: "default" | "raised" | "outline";
  padding?: "none" | "sm" | "md" | "lg";
  /** Adds hover feedback. Pair with a link or button inside. */
  interactive?: boolean;
}

const variants = {
  default: "bg-surface border-line",
  raised: "bg-raised border-line shadow-md",
  outline: "bg-transparent border-line-strong",
} as const;

const paddings = { none: "", sm: "p-4", md: "p-5 sm:p-6", lg: "p-6 sm:p-8" } as const;

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", padding = "md", interactive = false, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border",
        variants[variant],
        paddings[padding],
        interactive &&
          "transition-[background-color,border-color] duration-(--duration-base) ease-(--ease-out) hover:border-fg-subtle hover:bg-raised",
        className,
      )}
      {...rest}
    />
  );
});

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned action, e.g. a Button or Badge. */
  action?: ReactNode;
  className?: string;
}

export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
