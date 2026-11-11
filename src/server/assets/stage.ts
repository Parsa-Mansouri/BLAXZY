/**
 * Where an asset stands in pre-production, derived from its latest look and latest sheet. Pure:
 * the one definition every service (cards, detail, overview, completion) uses.
 *
 * Image assets: needs_image → generating → look_review → building_sheet → sheet_review → ready,
 * plus failed (the look or the sheet could not be produced). Voices: needs_recording → ready (a
 * recording is accepted on upload and has no sheet).
 */
import type { AssetKind, LookSource, LookStatus } from "@/server/db/schema";

export const ASSET_STAGES = [
  "needs_image",
  "needs_recording",
  "generating",
  "look_review",
  "building_sheet",
  "sheet_review",
  "ready",
  "failed",
] as const;
export type AssetStage = (typeof ASSET_STAGES)[number];

export type StageLook = { id: string; status: LookStatus; source: LookSource };
export type StageSheet = { lookId: string; status: LookStatus };

export type AssetState = {
  stage: AssetStage;
  /** What failed when the stage is `failed`. */
  failed: "look" | "sheet" | null;
  /** A dami or a generation is working on the latest look or sheet. */
  busy: boolean;
};

/**
 * @param latestLook the asset's look with the highest version number, any status
 * @param latestSheet the asset's sheet with the highest version number, any status
 */
export function deriveAssetState(
  kind: AssetKind,
  latestLook: StageLook | null,
  latestSheet: StageSheet | null,
): AssetState {
  const busy = latestLook?.status === "pending" || latestSheet?.status === "pending";
  const state = (stage: AssetStage, failed: AssetState["failed"] = null): AssetState => ({
    stage,
    failed,
    busy,
  });

  if (kind === "voice") {
    return state(latestLook?.status === "accepted" ? "ready" : "needs_recording");
  }
  if (!latestLook) return state("needs_image");
  switch (latestLook.status) {
    case "pending":
      return state("generating");
    case "in_review":
      return state("look_review");
    case "failed":
      return state("failed", "look");
    case "rejected":
    case "superseded":
      // A rejected generated look always has a newer (fixed) look, so only an uploaded one ends
      // here; a superseded latest look means the user started over (replaceLook).
      return state("needs_image");
    case "accepted":
      break;
  }

  // The look is accepted: the sheet built from it decides.
  const sheet = latestSheet && latestSheet.lookId === latestLook.id ? latestSheet : null;
  if (!sheet) return state("building_sheet");
  switch (sheet.status) {
    case "in_review":
      return state("sheet_review");
    case "accepted":
      return state("ready");
    case "failed":
      return state("failed", "sheet");
    case "pending":
    case "rejected":
    case "superseded":
      return state("building_sheet");
  }
}

/** The stage alone (see `deriveAssetState`). */
export function deriveAssetStage(
  kind: AssetKind,
  latestLook: StageLook | null,
  latestSheet: StageSheet | null,
): AssetStage {
  return deriveAssetState(kind, latestLook, latestSheet).stage;
}
