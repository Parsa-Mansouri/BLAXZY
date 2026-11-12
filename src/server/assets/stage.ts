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

/** True when the asset waits for the user: anything but ready or being worked on by a job. */
export function stageNeedsUser(stage: AssetStage): boolean {
  return stage !== "ready" && stage !== "generating" && stage !== "building_sheet";
}

export type OrderedAsset = { id: string; kind: AssetKind; displayOrder: number; stage: AssetStage };

/**
 * The asset to send the user to after `afterId`: the first one that waits for them, in the
 * overview's order (kinds in `kindOrder`, then display order, then id), after `afterId` and
 * wrapping around to the start. Never `afterId` itself; null when nothing else waits. Pure.
 */
export function pickNextAsset<T extends OrderedAsset>(
  assets: readonly T[],
  afterId: string,
  kindOrder: readonly AssetKind[],
): T | null {
  const rank = (kind: AssetKind) => {
    const i = kindOrder.indexOf(kind);
    return i === -1 ? kindOrder.length : i;
  };
  const sorted = [...assets].sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      a.displayOrder - b.displayOrder ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const at = sorted.findIndex((a) => a.id === afterId);
  // Not in the list (removed meanwhile): start from the beginning.
  const ordered = at === -1 ? sorted : [...sorted.slice(at + 1), ...sorted.slice(0, at)];
  return ordered.find((a) => a.id !== afterId && stageNeedsUser(a.stage)) ?? null;
}
