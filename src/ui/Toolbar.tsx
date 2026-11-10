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
  /** Short page title. Never the app name. */
  title: ReactNode;
  /** Content after the title, e.g. a stage indicator. */
  leading?: ReactNode;
  /** The screen's actions; at most one prominent. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * The content pane's toolbar: sidebar button at the far leading edge, then the title, actions on
 * the trailing side. Black, with a hairline only once the content has scrolled under it.
 */
export function Toolbar({ title, leading, trailing, className }: ToolbarProps) {
  const scrolled = useScrolled();
  return (
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        "sticky top-0 z-(--z-toolbar) flex h-(--toolbar-h) shrink-0 items-center gap-2 bg-ground pr-(--content-x) pl-3",
        "data-[scrolled]:hairline-b",
        className,
      )}
    >
      <SidebarToggle />
      <h1 className="min-w-0 truncate pl-1 text-title-3">{title}</h1>
      {leading ? <div className="flex min-w-0 items-center">{leading}</div> : null}
      {trailing ? <div className="ml-auto flex shrink-0 items-center gap-2">{trailing}</div> : null}
    </header>
  );
}
