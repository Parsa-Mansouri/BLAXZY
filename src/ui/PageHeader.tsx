import type { ReactNode } from "react";
import { cn } from "./cn";

export interface PageHeaderProps {
  /** The page title. Fixed words ("Script", "Characters") are set in capitals by the header. */
  title: ReactNode;
  /**
   * Keep the title's own case. Set it for user-written names: a film title, a character's name.
   * Default false: the title is set in capitals.
   */
  keepCase?: boolean;
  /**
   * One sentence under the title (15/22, secondary colour), or a StatusLine. Strings are wrapped
   * in a paragraph; other content is placed as it is.
   */
  description?: ReactNode;
  /** The page's actions, right-aligned on the title row, bottom-aligned. One primary at most. */
  actions?: ReactNode;
  /** Heading element. `h1` (default) for the page; `h2` when the header sits inside a region. */
  as?: "h1" | "h2";
  /** id on the heading, for `aria-labelledby`. */
  titleId?: string;
  className?: string;
}

/**
 * Every signed-in page starts with this: a 48px title rising out of its mask (650ms), a 48x3
 * brand rule wiping in under it (500ms, 180ms delay), then the description and the actions
 * fading up (`in-1`). Put the page's main region in `in-2` and the secondary one in `in-3`.
 *
 * Long titles (user-written film names) wrap in balanced lines at most 22 characters wide and
 * break inside a long word rather than overflow; the title is optically aligned to the text
 * below. Say the specific thing: "Is this Jonas?", "No films yet", never "Review" or "Details".
 */
export function PageHeader({
  title,
  keepCase = false,
  description,
  actions,
  as: Heading = "h1",
  titleId,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn("mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}
    >
      <div className="min-w-0">
        {/*
          The mask is set at the title's size so its 0.12em bottom pad clears descenders of
          user-written names, and pulled left by the capitals' side bearing (optical-edge) so
          the title's first stroke lines up with the rule and the text below.
        */}
        <div className="optical-edge rise-mask text-display">
          <Heading
            id={titleId}
            className={cn(
              "rise max-w-[22ch] text-display text-balance break-words hyphens-manual",
              !keepCase && "uppercase",
            )}
          >
            {title}
          </Heading>
        </div>
        <div aria-hidden="true" className="mt-3 h-0.75 w-12 rule-in rounded-mark bg-brand" />
        {description !== undefined && description !== null ? (
          typeof description === "string" ? (
            <p className="mt-3 max-w-(--measure) in-1 text-body text-pretty text-label-2">
              {description}
            </p>
          ) : (
            <div className="mt-3 in-1">{description}</div>
          )
        ) : null}
      </div>
      {actions ? <div className="flex in-1 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
