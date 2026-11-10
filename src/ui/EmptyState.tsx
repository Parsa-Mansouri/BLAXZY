import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  /** One calm sentence saying what happens here and what to do next. */
  description?: ReactNode;
  /** Primary action, usually a Button. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-lg border border-dashed border-line-strong px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent-text [&_svg]:size-6">
          {icon}
        </span>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
