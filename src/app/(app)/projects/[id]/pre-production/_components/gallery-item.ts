import type { Asset, AssetCard, AssetStage } from "@/server/assets";
import type { PictureAspect } from "@/ui";

type Kind = Asset["kind"];

/** What a tile needs of an asset. Plain data, so client components can hold it. */
export interface GalleryItem {
  id: string;
  kind: Kind;
  name: string;
  description: string | null;
  /** required, optional (may be skipped) or skipped (not designed). */
  priority: Asset["priority"];
  stage: AssetStage;
  thumbnailFileId: string | null;
}

export function toGalleryItem(card: AssetCard): GalleryItem {
  return {
    id: card.asset.id,
    kind: card.asset.kind,
    name: card.asset.name,
    description: card.asset.description,
    priority: card.asset.priority,
    stage: card.stage,
    thumbnailFileId: card.thumbnailFileId,
  };
}

/** The picture shape of each kind: people stand, places are wide, things are square. */
export const KIND_ASPECTS: Record<Kind, PictureAspect> = {
  character: "portrait",
  creature: "portrait",
  costume: "portrait",
  location: "video",
  prop: "square",
  voice: "square",
  other: "square",
};
