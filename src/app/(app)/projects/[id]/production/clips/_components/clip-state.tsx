import {
  CircleCheck,
  Clock,
  Eye,
  ListChecks,
  Loader,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { BlockProductionStage } from "@/server/production";
import { cn } from "@/ui";
import { CLIP_STATE_LABELS } from "../_lib/clip-view";

interface StateView {
  icon: LucideIcon;
  /** Work runs in the background: the glyph turns. */
  working: boolean;
  tone: "quiet" | "review" | "good" | "warn";
}

const STATE_VIEWS: Record<BlockProductionStage, StateView> = {
  preparing: { icon: Loader, working: true, tone: "quiet" },
  prepare_failed: { icon: TriangleAlert, working: false, tone: "warn" },
  block_review: { icon: ListChecks, working: false, tone: "quiet" },
  approved: { icon: Clock, working: false, tone: "quiet" },
  draft_generating: { icon: Loader, working: true, tone: "quiet" },
  draft_review: { icon: Eye, working: false, tone: "review" },
  final_generating: { icon: Loader, working: true, tone: "quiet" },
  final_review: { icon: Eye, working: false, tone: "review" },
  done: { icon: CircleCheck, working: false, tone: "good" },
  failed: { icon: TriangleAlert, working: false, tone: "warn" },
};

const TONES = {
  quiet: "text-label-2",
  review: "text-label font-medium",
  good: "text-green",
  warn: "text-orange",
} as const;

/** A shot's state in words with a small glyph: the one vocabulary of the board and the clip page. */
export function ClipState({
  stage,
  className,
}: {
  stage: BlockProductionStage;
  className?: string;
}) {
  const view = STATE_VIEWS[stage];
  const Icon = view.icon;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-callout", TONES[view.tone], className)}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cn(
          "size-(--icon-sm) shrink-0",
          view.working && "animate-spin motion-reduce:animate-none",
        )}
      />
      {CLIP_STATE_LABELS[stage]}
    </span>
  );
}
