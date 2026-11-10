"use client";

import { Check, Lock } from "lucide-react";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

export type StageStatus = "done" | "current" | "upcoming" | "locked";

export interface StageListItem {
  id: string;
  label: string;
  status: StageStatus;
  /** Why a locked stage is locked, shown as its tooltip. */
  lockedHint?: string;
}

export interface StageListProps {
  stages: StageListItem[];
  /** Accessible name, e.g. "Stages". */
  "aria-label"?: string;
  className?: string;
}

const statusText: Record<StageStatus, string> = {
  done: "done",
  current: "current stage",
  upcoming: "not started",
  locked: "locked",
};

function Glyph({ status }: { status: StageStatus }) {
  const box = "flex size-(--icon) shrink-0 items-center justify-center";
  if (status === "done") {
    return <Check aria-hidden="true" className={cn(box, "text-label-2")} strokeWidth={2.25} />;
  }
  if (status === "locked") {
    return <Lock aria-hidden="true" className={cn(box, "p-px text-label-2")} />;
  }
  return (
    <span aria-hidden="true" className={box}>
      <span
        className={cn(
          "size-2 rounded-full",
          status === "current" ? "bg-label" : "ring-1 ring-label-2 ring-inset",
        )}
      />
    </span>
  );
}

/**
 * The four stages of a project as sidebar rows: a checkmark when done, a filled dot for the
 * current stage, a lock when not yet available (with the reason as a tooltip).
 */
export function StageList({
  stages,
  className,
  "aria-label": ariaLabel = "Stages",
}: StageListProps) {
  return (
    <ol aria-label={ariaLabel} className={cn("flex flex-col gap-px", className)}>
      {stages.map((stage) => {
        const row = (
          <div
            tabIndex={stage.status === "locked" && stage.lockedHint ? 0 : undefined}
            className={cn(
              "flex min-h-(--sidebar-row-h) items-center gap-2 rounded-control px-2 text-body focus-ring",
              stage.status === "current" ? "bg-selection text-label" : "text-label-2",
              stage.status === "done" && "text-label",
            )}
          >
            <Glyph status={stage.status} />
            <span className="min-w-0 flex-1 truncate">{stage.label}</span>
            <span className="sr-only">, {statusText[stage.status]}</span>
          </div>
        );
        return (
          <li key={stage.id} aria-current={stage.status === "current" ? "step" : undefined}>
            {stage.status === "locked" && stage.lockedHint ? (
              <Tooltip content={stage.lockedHint} side="right" delay={300}>
                {row}
              </Tooltip>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ol>
  );
}
