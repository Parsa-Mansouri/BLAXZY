"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useActiveStages } from "@/app/(app)/_lib/use-active-stages";
import { Popover, StageList, type StageListItem } from "@/ui";

/**
 * "Step 2 of 4 · Script" in the toolbar, shown only while the sidebar (and its stage list) is
 * hidden: collapsed on wide screens, or on narrow ones. Opens the stage list in a popover.
 */
export function StageIndicator({ step, stages }: { step: string; stages: StageListItem[] }) {
  const items = useActiveStages(stages);
  const current = stages.find((s) => s.status === "current");
  return (
    <div className="min-w-0 shell:group-data-[sidebar=expanded]/shell:hidden">
      <Popover
        align="start"
        aria-label="Stages"
        className="w-60 p-1.5"
        trigger={
          <button
            type="button"
            className="ml-1 inline-flex h-(--control-h) max-w-full items-center gap-1 rounded-control px-2 text-body whitespace-nowrap text-label-2 focus-ring hover:bg-fill-4 hover:text-label data-[popup-open]:bg-fill-4 data-[popup-open]:text-label"
          >
            <span className="truncate">
              {step}
              {current ? ` · ${current.label}` : null}
            </span>
            <ChevronDown aria-hidden="true" className="size-(--icon-sm) shrink-0" />
          </button>
        }
      >
        <StageList stages={items} linkAs={Link} />
      </Popover>
    </div>
  );
}
