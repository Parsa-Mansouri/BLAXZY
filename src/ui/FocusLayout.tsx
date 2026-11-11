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
  className?: string;
}

/**
 * "List left, focus right". The list chooses what the focus area shows; the user can jump to any
 * row (no forced Next). The list arrives with `in-2`, the focus area with `in-3`; below about
 * 700px the focus area wraps under the list.
 */
export function FocusLayout({
  list,
  listLabel,
  children,
  listWidth = "regular",
  listAs: ListTag = "nav",
  className,
}: FocusLayoutProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start",
        listWidth === "narrow" ? "gap-10" : "gap-x-20 gap-y-10",
        className,
      )}
    >
      <ListTag
        aria-label={listLabel}
        className={cn(
          "flex min-w-0 in-2 flex-col gap-0.5",
          listWidth === "narrow" ? "flex-[1_1_200px] sm:max-w-58" : "flex-[1_1_260px] sm:max-w-80",
        )}
      >
        {list}
      </ListTag>
      <div
        className={cn(
          "min-w-0 in-3",
          listWidth === "narrow" ? "flex-[4_1_640px]" : "max-w-190 flex-[2_1_380px]",
        )}
      >
        {children}
      </div>
    </div>
  );
}
