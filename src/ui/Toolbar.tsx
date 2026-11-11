"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "./cn";
import { SidebarToggle } from "./SplitView";

function subscribeScroll(callback: () => void): () => void {
  window.addEventListener("scroll", callback, { passive: true });
  return () => window.removeEventListener("scroll", callback);
}

/** True once the page has scrolled away from the top. */
export function useScrolled(): boolean {
  return useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > 0,
    () => false,
  );
}

export interface ToolbarProps {
  /**
   * Leading content: the project name, or a BackControl on deeper pages. A string is set in the
   * secondary colour at 15px.
   */
  title?: ReactNode;
  /**
   * Element for the title. `h1` (default) only on pages without a PageHeader; inside a project
   * the PageHeader holds the h1, so the toolbar uses `div`.
   */
  titleAs?: "h1" | "div";
  /** Content right after the title. */
  leading?: ReactNode;
  /** Trailing content, e.g. the stage strip or a page's actions. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * The content pane's top bar, 64px: the sidebar button (only while the sidebar is hidden), the
 * title or back control, and trailing content such as the stage strip. Black, with a hairline
 * once the content has scrolled under it. It wraps onto two lines on narrow screens.
 */
export function Toolbar({ title, titleAs = "h1", leading, trailing, className }: ToolbarProps) {
  const scrolled = useScrolled();
  const Title = titleAs;
  return (
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        "sticky top-0 z-(--z-toolbar) flex min-h-(--toolbar-h) shrink-0 flex-wrap items-center gap-x-6 gap-y-3 bg-ground px-(--content-x) py-3",
        "data-[scrolled]:hairline-b",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <SidebarToggle className="-ml-2 shell:group-data-[sidebar=expanded]/shell:hidden" />
        {title !== undefined && title !== null ? (
          <Title
            className={cn(
              "min-w-0 text-body font-medium text-label-2",
              typeof title === "string" ? "truncate" : "flex items-center",
            )}
          >
            {title}
          </Title>
        ) : null}
        {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
      </div>
      {trailing ? (
        <div className="ml-auto flex max-w-full min-w-0 shrink-0 items-center gap-2">
          {trailing}
        </div>
      ) : null}
    </header>
  );
}
