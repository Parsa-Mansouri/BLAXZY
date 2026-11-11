import type { AssetStage } from "@/server/assets";
import { StatusLine, type StatusTone } from "@/ui";
import { ASSET_STATUS_LABELS } from "../../_lib/asset-status";

/** Status colour of each stage: amber waits for the user, grey is working or not started. */
export const STAGE_TONES: Record<AssetStage, StatusTone> = {
  needs_image: "working",
  needs_recording: "working",
  generating: "working",
  look_review: "waiting",
  building_sheet: "working",
  sheet_review: "waiting",
  ready: "done",
  failed: "failed",
};

const WORKING: readonly AssetStage[] = ["generating", "building_sheet"];

/** True while the worker is producing something for the asset. */
export function isWorking(stage: AssetStage): boolean {
  return WORKING.includes(stage);
}

/** The state of an asset as a status line: a dot and the stage in words. */
export function StageStatus({ stage, className }: { stage: AssetStage; className?: string }) {
  return (
    <StatusLine tone={STAGE_TONES[stage]} className={className}>
      {ASSET_STATUS_LABELS[stage]}
    </StatusLine>
  );
}
