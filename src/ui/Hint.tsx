import type { ReactNode } from "react";
import { Lightbulb, Info, TriangleAlert } from "lucide-react";
import { cn } from "./cn";

export interface HintProps {
  children: ReactNode;
  /** "tip" suggests, "info" explains, "warning" cautions. */
  tone?: "tip" | "info" | "warning";
  /** Replace the default icon. */
  icon?: ReactNode;
  className?: string;
}

const defaults = {
  tip: { Icon: Lightbulb, color: "text-accent-text" },
  info: { Icon: Info, color: "text-fg-subtle" },
  warning: { Icon: TriangleAlert, color: "text-warning" },
} as const;

/** Always-visible helper line. Quiet by design: it should be read, not noticed. */
export function Hint({ children, tone = "tip", icon, className }: HintProps) {
  const { Icon, color } = defaults[tone];
  return (
    <p className={cn("flex items-start gap-2 text-sm text-fg-muted", className)}>
      <span aria-hidden="true" className={cn("mt-[3px] shrink-0 [&_svg]:size-4", color)}>
        {icon ?? <Icon />}
      </span>
      <span>{children}</span>
    </p>
  );
}
