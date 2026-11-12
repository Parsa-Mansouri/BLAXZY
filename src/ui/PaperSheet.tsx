import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";

export interface PaperSheetProps {
  /** Scene heading in bold, e.g. "INT. LIGHTHOUSE - NIGHT". */
  heading?: ReactNode;
  /** Heading element for the scene heading. */
  headingAs?: "h2" | "h3";
  /** The screenplay: ScreenplayAction and ScreenplayDialogue blocks, or any content. */
  children: ReactNode;
  as?: ElementType;
  className?: string;
}

/**
 * Screenplay text: Courier Prime 16/24 in ink (#1b1a17) on a paper sheet (#efe7d3), at most
 * 680px wide. No drop shadow (on black it said nothing). Paper has its own selection, focus,
 * caret, placeholder and link colours (all ink).
 */
export function PaperSheet({
  heading,
  headingAs: Heading = "h2",
  children,
  as: Tag = "article",
  className,
}: PaperSheetProps) {
  return (
    <Tag
      className={cn(
        "flex w-full max-w-170 flex-col gap-6 rounded-paper px-[clamp(20px,4vw,52px)] py-11 font-script text-script paper",
        className,
      )}
    >
      {heading ? <Heading className="font-bold">{heading}</Heading> : null}
      {children}
    </Tag>
  );
}

/** An action paragraph on the paper sheet. */
export function ScreenplayAction({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={className}>{children}</p>;
}

/** A character's line: the name indented, then the speech, both set in from the edges. */
export function ScreenplayDialogue({
  who,
  children,
  className,
}: {
  /** The character's name, in capitals as written in the script. */
  who: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-[12%]", className)}>
      <p className="pl-[30%]">{who}</p>
      <p>{children}</p>
    </div>
  );
}
