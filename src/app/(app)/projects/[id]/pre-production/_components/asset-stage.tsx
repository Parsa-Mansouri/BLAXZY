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
import { ASSET_STATUS_LABELS } from "../../_lib/asset-status";

interface StageView {
  label: string;
  icon: LucideIcon;
  /** Work is running in the background. */
  working: boolean;
  tone: "quiet" | "good" | "warn";
}

export const STAGE_VIEWS: Record<AssetStage, StageView> = {
  needs_image: {
    label: ASSET_STATUS_LABELS.needs_image,
    icon: ImagePlus,
    working: false,
    tone: "quiet",
  },
  needs_recording: {
    label: ASSET_STATUS_LABELS.needs_recording,
    icon: Mic,
    working: false,
    tone: "quiet",
  },
  generating: { label: ASSET_STATUS_LABELS.generating, icon: Loader, working: true, tone: "quiet" },
  look_review: { label: ASSET_STATUS_LABELS.look_review, icon: Eye, working: false, tone: "quiet" },
  building_sheet: {
    label: ASSET_STATUS_LABELS.building_sheet,
    icon: LayoutGrid,
    working: true,
    tone: "quiet",
  },
  sheet_review: {
    label: ASSET_STATUS_LABELS.sheet_review,
    icon: Eye,
    working: false,
    tone: "quiet",
  },
  ready: { label: ASSET_STATUS_LABELS.ready, icon: CircleCheck, working: false, tone: "good" },
  failed: { label: ASSET_STATUS_LABELS.failed, icon: TriangleAlert, working: false, tone: "warn" },
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
