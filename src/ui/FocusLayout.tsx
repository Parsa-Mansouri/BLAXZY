import type { ReactNode } from "react";
import { cn } from "./cn";

export interface FocusLayoutProps {
  /** The list that chooses what the focus area shows (SelectRows). */
  list: ReactNode;
  /** Accessible name of the list's `<nav>`, e.g. "Scenes", "Your style choices". */
  listLabel: string;
  /** The focus area: the one question, scene or sheet being worked on. */
  children: ReactNode;
  /** `narrow` 232px (scenes beside a paper sheet), `regular` 320px (questions, sheets). */
  listWidth?: "narrow" | "regular";
  /** Render the list as a plain `<div>` instead of a `<nav>` (when it is not navigation). */
  listAs?: "nav" | "div";
  /**
   * Fill the height left in the page (the layout grows inside a flex column such as a project
   * stage page) and make the focus area a flex column of that height, so a screen can pin its
   * main action to the bottom with `mt-auto`. Default false: the layout is as tall as its
   * content.
   */
  fill?: boolean;
  className?: string;
  /** Classes for the focus area. */
  focusClassName?: string;
}

/**
 * "List left, focus right". The list chooses what the focus area shows; the user can jump to any
 * row (no forced Next). The focus area takes all the width the list leaves (no cap). The list
 * arrives with `in-2`, the focus area with `in-3`; below about 780px the focus area wraps under
 * the list.
 */
export function FocusLayout({
  list,
  listLabel,
  children,
  listWidth = "regular",
  listAs: ListTag = "nav",
  fill = false,
  className,
  focusClassName,
}: FocusLayoutProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap",
        fill ? "min-h-0 flex-1 items-stretch" : "items-start",
        listWidth === "narrow" ? "gap-10" : "gap-x-20 gap-y-10",
        className,
      )}
    >
      <ListTag
        aria-label={listLabel}
        className={cn(
          "flex min-w-0 in-2 flex-col gap-0.5",
          fill && "self-start",
          listWidth === "narrow" ? "flex-[1_1_200px] sm:max-w-58" : "flex-[1_1_260px] sm:max-w-80",
        )}
      >
        {list}
      </ListTag>
      <div
        className={cn("min-w-0 flex-[999_1_380px] in-3", fill && "flex flex-col", focusClassName)}
      >
        {children}
      </div>
    </div>
  );
}
