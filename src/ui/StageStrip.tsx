"use client";

import type { ComponentType, ReactNode } from "react";
import { cn } from "./cn";
import type { StageStatus } from "./StageList";
import { Tooltip } from "./Tooltip";

export interface StageStripItem {
  id: string;
  /** Fixed stage name; set in 13px capitals. */
  label: string;
  status: StageStatus;
  /** Route of the stage. Only done and current stages open (a stage opens if current or earlier). */
  href?: string;
  /** Why a locked stage is locked, shown as its tooltip, e.g. "Finish Script first". */
  lockedHint?: string;
  /** Relative width; give a long label more room, e.g. 1.5 for "Pre-production". Default 1. */
  grow?: number;
  /** The stage whose screen is being shown. Its label turns white. */
  active?: boolean;
}

type LinkLike = ComponentType<{
  href: string;
  className?: string;
  "aria-current"?: "page";
  children?: ReactNode;
}>;

export interface StageStripProps {
  stages: StageStripItem[];
  /** Link component, e.g. Next's `Link`. Defaults to a plain anchor. */
  linkAs?: LinkLike;
  "aria-label"?: string;
  className?: string;
}

function PlainLink(props: {
  href: string;
  className?: string;
  "aria-current"?: "page";
  children?: ReactNode;
}) {
  return <a {...props} />;
}

const statusText: Record<StageStatus, string> = {
  done: "done",
  current: "current stage",
  upcoming: "not started",
  locked: "locked",
};

const bars: Record<StageStatus, string> = {
  done: "bg-stage-done",
  current: "bg-accent",
  upcoming: "bg-stage-todo",
  locked: "bg-stage-todo",
};

/**
 * The project's four stages as a slim strip in the toolbar: a 2px bar over each 13px capital
 * label. Done stages have a grey bar, the current stage a white one, later stages a dark one.
 * The stage being viewed has a white label. Done and current stages are links; locked ones
 * explain themselves in a tooltip.
 */
export function StageStrip({
  stages,
  linkAs: LinkAs = PlainLink,
  "aria-label": ariaLabel = "Stages",
  className,
}: StageStripProps) {
  const anyActive = stages.some((s) => s.active);
  return (
    <ol
      aria-label={ariaLabel}
      className={cn("flex w-120 max-w-full min-w-0 gap-1.5 sm:min-w-75", className)}
    >
      {stages.map((stage) => {
        const viewed = anyActive ? Boolean(stage.active) : stage.status === "current";
        const open = Boolean(stage.href) && stage.status !== "locked";
        const content = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "h-0.5 w-full transition-colors duration-(--dur-press)",
                bars[stage.status],
              )}
            />
            <span
              className={cn(
                "truncate caps-label transition-colors duration-(--dur-press)",
                viewed ? "text-label" : "text-label-3",
                open && !viewed && "group-hover/stage:text-label",
              )}
            >
              {stage.label}
            </span>
            <span className="sr-only">, {statusText[stage.status]}</span>
          </>
        );
        const cellClass = "group/stage flex min-w-0 flex-col gap-2 rounded-[2px] pb-0.5 focus-ring";
        return (
          <li
            key={stage.id}
            aria-current={stage.status === "current" ? "step" : undefined}
            className="min-w-0"
            style={{ flex: `${stage.grow ?? 1} 1 0%` }}
          >
            {open && stage.href ? (
              <LinkAs
                href={stage.href}
                aria-current={stage.active ? "page" : undefined}
                className={cellClass}
              >
                {content}
              </LinkAs>
            ) : stage.status === "locked" && stage.lockedHint ? (
              <Tooltip content={stage.lockedHint} side="bottom" delay={300}>
                <span tabIndex={0} className={cellClass}>
                  {content}
                </span>
              </Tooltip>
            ) : (
              <span className={cellClass}>{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
