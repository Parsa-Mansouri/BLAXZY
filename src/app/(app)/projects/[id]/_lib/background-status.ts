import { countAssetsByKind, hasDetectionFor } from "@/server/assets";
import { getSectioningStatus, type SectioningState } from "@/server/blocks";
import type { AssetKindKey } from "./asset-kinds";

/** What runs in the background after a script is accepted: detection, then sectioning. */
export interface BackgroundStatus {
  state: SectioningState;
  /** Assets of the accepted version have been found (sectioning comes next). */
  detected: boolean;
  blockCount: number;
  failure: string | null;
  /** Shots the last script edit sent back through Production's preparation. */
  resetBlocks: number;
  counts: Record<AssetKindKey, number>;
}

/** Null when the project is missing or not the user's. */
export async function loadBackgroundStatus(
  projectId: string,
  userId: string,
  acceptedVersionId: string | null,
): Promise<BackgroundStatus | null> {
  const status = await getSectioningStatus(projectId, userId);
  if (!status) return null;
  const [counts, detected] = await Promise.all([
    countAssetsByKind(projectId, userId),
    acceptedVersionId ? hasDetectionFor(projectId, acceptedVersionId) : Promise.resolve(false),
  ]);
  if (!counts) return null;
  return {
    state: status.state,
    detected,
    blockCount: status.blockCount,
    failure: status.failure,
    resetBlocks: status.resetBlocks,
    counts,
  };
}
