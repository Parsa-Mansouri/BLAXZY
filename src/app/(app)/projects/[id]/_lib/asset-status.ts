import type { AssetStage } from "@/server/assets";

/** The one vocabulary for an asset's state: tiles, the detail page and Review All all use it. */
export const ASSET_STATUS_LABELS: Record<AssetStage, string> = {
  needs_image: "Needs Image",
  needs_recording: "Needs Recording",
  generating: "Creating Image",
  look_review: "Review Image",
  building_sheet: "Building Sheet",
  sheet_review: "Review Sheet",
  ready: "Ready",
  failed: "Needs Attention",
};

export const assetStatusLabel = (stage: AssetStage) => ASSET_STATUS_LABELS[stage];
