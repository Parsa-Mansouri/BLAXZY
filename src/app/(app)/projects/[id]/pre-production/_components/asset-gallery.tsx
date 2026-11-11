import Link from "next/link";
import {
  AudioLines,
  Box,
  MapPin,
  PawPrint,
  Plus,
  Shapes,
  Shirt,
  User,
  type LucideIcon,
} from "lucide-react";
import { fileSrc } from "@/lib/file-src";
import type { Asset, AssetStage } from "@/server/assets";
import { Spinner, cn } from "@/ui";
import { assetHref } from "../../_lib/asset-kinds";
import { StageLabel, isWorking } from "./asset-stage";

type Kind = Asset["kind"];

export type Frame = "portrait" | "wide" | "square";

/** What a tile needs of an asset. Plain data, so client components can hold it. */
export interface GalleryItem {
  id: string;
  kind: Kind;
  name: string;
  description: string | null;
  stage: AssetStage;
  thumbnailFileId: string | null;
}

export const KIND_ICONS: Record<Kind, LucideIcon> = {
  character: User,
  location: MapPin,
  prop: Box,
  voice: AudioLines,
  creature: PawPrint,
  costume: Shirt,
  other: Shapes,
};

export const KIND_FRAMES: Record<Kind, Frame> = {
  character: "portrait",
  creature: "portrait",
  costume: "portrait",
  location: "wide",
  prop: "square",
  voice: "square",
  other: "square",
};

/** Class names are literal so Tailwind can see them. */
const FRAME_ASPECT: Record<Frame, string> = {
  portrait: "aspect-[4/5]",
  wide: "aspect-[2.39/1]",
  square: "aspect-square",
};

const FRAME_RATIO: Record<Frame, readonly [number, number]> = {
  portrait: [800, 1000],
  wide: [1434, 600],
  square: [800, 800],
};

/** Two tiles per row on phones for portrait and square frames; one for wide. */
const GRID_COLUMNS: Record<Frame, string> = {
  portrait: "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))]",
  wide: "grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))]",
  square: "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))]",
};

const TILE_LINK =
  "group/tile flex min-w-0 flex-col gap-2 rounded-artwork focus-ring outline-offset-4";

function Caption({ item }: { item: GalleryItem }) {
  return (
    <div className="flex flex-col gap-0.5 px-0.5">
      <span className="line-clamp-2 text-headline text-label">{item.name}</span>
      <StageLabel stage={item.stage} />
    </div>
  );
}

function AssetImage({ item, frame }: { item: GalleryItem; frame: Frame }) {
  const Icon = KIND_ICONS[item.kind];
  const [width, height] = FRAME_RATIO[frame];
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-artwork bg-elevated",
        FRAME_ASPECT[frame],
      )}
    >
      {item.thumbnailFileId ? (
        // eslint-disable-next-line @next/next/no-img-element -- user media from object storage, sized by the frame
        <img
          src={fileSrc(item.thumbnailFileId)}
          alt=""
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          className={cn(
            "size-full object-cover transition-opacity duration-(--dur-base) group-hover/tile:opacity-90 motion-reduce:transition-none",
            frame === "portrait" && "object-top",
          )}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-3 text-label-3">
          <Icon aria-hidden strokeWidth={1.25} className="size-10" />
          {isWorking(item.stage) ? (
            <Spinner size="lg" label="Working" />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-capsule bg-fill text-label transition-colors duration-(--dur-fast) group-hover/tile:bg-fill-2">
              <Plus aria-hidden strokeWidth={2} className="size-5" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function VoiceTile({ item }: { item: GalleryItem }) {
  return (
    <div className="flex items-center gap-3 rounded-group bg-elevated px-3 py-2.5 transition-colors duration-(--dur-fast) group-hover/tile:bg-elevated-2">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-capsule bg-fill text-label-2">
        <AudioLines aria-hidden strokeWidth={1.5} className="size-5" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 text-headline text-label">{item.name}</span>
        <StageLabel stage={item.stage} />
      </div>
    </div>
  );
}

/** Asset tiles of one kind: the image frame leads, name and state follow. Each opens the asset. */
export function AssetGallery({ projectId, items }: { projectId: string; items: GalleryItem[] }) {
  const kind = items[0]?.kind;
  if (!kind) return null;
  if (kind === "voice") {
    return (
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3">
        {items.map((item) => (
          <li key={item.id} className="min-w-0">
            <Link href={assetHref(projectId, item.id)} className={TILE_LINK}>
              <VoiceTile item={item} />
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  const frame = KIND_FRAMES[kind];
  return (
    <ul className={cn("grid gap-x-4 gap-y-7", GRID_COLUMNS[frame])}>
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          <Link href={assetHref(projectId, item.id)} className={TILE_LINK}>
            <AssetImage item={item} frame={frame} />
            <Caption item={item} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
