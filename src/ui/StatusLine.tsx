import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Status colours: `done` green, `waiting` amber (waiting for the user), `working` grey (working
 * or not started), `failed` red. `none` draws no dot.
 */
export type StatusTone = "done" | "waiting" | "working" | "failed" | "none";

export interface StatusLineProps {
  tone?: StatusTone;
  /** A few plain words: "1 to review · 2 need an image". Never "x of y" totals. */
  children: ReactNode;
  as?: ElementType;
  /** Text read before the line by screen readers when the dot carries meaning. */
  srPrefix?: string;
  className?: string;
}

const dots: Record<Exclude<StatusTone, "none">, string> = {
  done: "bg-done",
  waiting: "bg-waiting",
  working: "bg-working",
  failed: "bg-failed",
};

/** The status dot alone, 6px. */
export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  if (tone === "none") return null;
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full", dots[tone], className)}
    />
  );
}

/**
 * A real status line: Geist Mono 13/18 in the secondary colour, after a 6px status dot. The only
 * place the mono face is used.
 */
export function StatusLine({
  tone = "none",
  children,
  as: Tag = "p",
  srPrefix,
  className,
}: StatusLineProps) {
  return (
    <Tag
      className={cn(
        "flex flex-wrap items-center gap-x-2 font-mono text-meta text-label-2",
        className,
      )}
    >
      <StatusDot tone={tone} />
      {srPrefix ? <span className="sr-only">{srPrefix}: </span> : null}
      <span className="min-w-0">{children}</span>
    </Tag>
  );
}
