import type { ReactNode } from "react";
import { cn } from "@/ui";

/**
 * A Production screen as one composition: at least as tall as the viewport below the toolbar
 * (less the project layout's 32px top and 72px bottom padding), as a flex column, so the main
 * region can take the rest of the height with `flex-1`. Long content still scrolls the page.
 */
export function FillPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-[calc(100dvh-var(--toolbar-h)-6.5rem)] min-w-0 flex-col",
        className,
      )}
    >
      {children}
    </div>
  );
}
