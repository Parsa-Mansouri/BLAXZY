import {
  CircleCheck,
  Eye,
  ImagePlus,
  LayoutGrid,
  Loader,
  Mic,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { AssetStage } from "@/server/assets";
import { cn } from "@/ui";

interface StageView {
  label: string;
  icon: LucideIcon;
  /** Work is running in the background. */
  working: boolean;
  tone: "quiet" | "good" | "warn";
}

export const STAGE_VIEWS: Record<AssetStage, StageView> = {
  needs_image: { label: "Needs Image", icon: ImagePlus, working: false, tone: "quiet" },
  needs_recording: { label: "Needs Recording", icon: Mic, working: false, tone: "quiet" },
  generating: { label: "Creating Image", icon: Loader, working: true, tone: "quiet" },
  look_review: { label: "Review Image", icon: Eye, working: false, tone: "quiet" },
  building_sheet: { label: "Building Sheet", icon: LayoutGrid, working: true, tone: "quiet" },
  sheet_review: { label: "Review Sheet", icon: Eye, working: false, tone: "quiet" },
  ready: { label: "Ready", icon: CircleCheck, working: false, tone: "good" },
  failed: { label: "Needs Attention", icon: TriangleAlert, working: false, tone: "warn" },
};

/** True while the worker is producing something for the asset. */
export function isWorking(stage: AssetStage): boolean {
  return STAGE_VIEWS[stage].working;
}

const TONES = {
  quiet: "text-label-2",
  good: "text-green",
  warn: "text-orange",
} as const;

/** The state of an asset in words, with a small glyph. */
export function StageLabel({ stage, className }: { stage: AssetStage; className?: string }) {
  const view = STAGE_VIEWS[stage];
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
      {view.label}
    </span>
  );
}
