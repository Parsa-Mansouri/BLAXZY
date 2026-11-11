import { CircleCheck, Eye, LoaderCircle, TriangleAlert } from "lucide-react";
import type { BlockProductionStage } from "@/server/production";
import { cn } from "@/ui";
import { blockStateLabel } from "../_lib/block-state";

const BUSY: readonly BlockProductionStage[] = ["preparing", "draft_generating", "final_generating"];

/** A shot's state in words, with a small mark; colour only for approved and attention. */
export function BlockStateLabel({
  stage,
  className,
}: {
  stage: BlockProductionStage;
  className?: string;
}) {
  const attention = stage === "prepare_failed" || stage === "failed";
  const good = stage === "approved" || stage === "done";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-callout whitespace-nowrap",
        attention ? "text-orange" : good ? "text-green" : "text-label-2",
        className,
      )}
    >
      {BUSY.includes(stage) ? (
        <LoaderCircle
          aria-hidden
          className="size-(--icon-sm) animate-spin motion-reduce:animate-none"
        />
      ) : attention ? (
        <TriangleAlert aria-hidden className="size-(--icon-sm)" />
      ) : good ? (
        <CircleCheck aria-hidden className="size-(--icon-sm)" />
      ) : (
        <Eye aria-hidden className="size-(--icon-sm)" />
      )}
      {blockStateLabel(stage)}
    </span>
  );
}
