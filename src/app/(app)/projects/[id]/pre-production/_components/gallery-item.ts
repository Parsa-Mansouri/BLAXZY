import type { AssetCard } from "@/server/assets";
import type { GalleryItem } from "./asset-gallery";

export function toGalleryItem(card: AssetCard): GalleryItem {
  return {
    id: card.asset.id,
    kind: card.asset.kind,
    name: card.asset.name,
    description: card.asset.description,
    stage: card.stage,
    thumbnailFileId: card.thumbnailFileId,
  };
}
