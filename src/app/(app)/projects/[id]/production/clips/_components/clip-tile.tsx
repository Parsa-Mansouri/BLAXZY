import type { ReactNode } from "react";
import Link from "next/link";
import { Eye, Film, Loader, TriangleAlert } from "lucide-react";
import { fileSrc } from "@/lib/file-src";
import { cn } from "@/ui";
import {
  CLIP_STATE_LABELS,
  isUnsettled,
  needsAttention,
  needsReview,
  shotNumber,
  shotTitle,
  type ClipTileData,
  type Orientation,
} from "../_lib/clip-view";
import { clipHref } from "../_lib/routes";
import { ClipState } from "./clip-state";

/** Class names are literal so Tailwind can see them. */
const ASPECT: Record<Orientation, string> = {
  landscape: "aspect-video",
  portrait: "aspect-[9/16]",
};

const SIZE: Record<Orientation, readonly [number, number]> = {
  landscape: [1280, 720],
  portrait: [720, 1280],
};

/** Large tiles: two or three across on a desktop for wide films, more for upright ones. */
const COLUMNS: Record<Orientation, string> = {
  landscape: "grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))]",
  portrait: "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]",
};

export function BoardGrid({
  orientation,
  children,
}: {
  orientation: Orientation;
  children: ReactNode;
}) {
  return <ul className={cn("grid gap-x-5 gap-y-8", COLUMNS[orientation])}>{children}</ul>;
}

/**
 * One shot: its newest poster large on black, its number and title, and its state in words. A shot
 * waiting for review carries a white mark on the poster, so it is found first.
 */
export function ClipTile({
  projectId,
  tile,
  orientation,
}: {
  projectId: string;
  tile: ClipTileData;
  orientation: Orientation;
}) {
  const review = needsReview(tile.stage);
  const working = isUnsettled(tile.stage);
  const attention = needsAttention(tile.stage);
  const title = shotTitle(tile);
  const [width, height] = SIZE[orientation];
  return (
    <li className="min-w-0">
      <Link
        href={clipHref(projectId, tile.lineageId)}
        aria-label={`Shot ${shotNumber(tile.orderIndex)}, ${title}: ${CLIP_STATE_LABELS[tile.stage]}`}
        className="group/tile flex min-w-0 flex-col gap-2.5 rounded-artwork focus-ring outline-offset-4"
      >
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-artwork",
            ASPECT[orientation],
            tile.posterFileId ? "bg-ground" : "bg-elevated",
            review &&
              "ring-2 ring-accent ring-offset-2 ring-offset-ground transition-[box-shadow] duration-(--dur-fast)",
            !review &&
              "transition-[box-shadow] duration-(--dur-fast) group-hover/tile:ring-1 group-hover/tile:ring-separator-opaque",
          )}
        >
          {tile.posterFileId ? (
            // eslint-disable-next-line @next/next/no-img-element -- a redirect to a presigned URL
            <img
              src={fileSrc(tile.posterFileId)}
              alt=""
              width={width}
              height={height}
              loading="lazy"
              decoding="async"
              draggable={false}
              className={cn(
                "absolute inset-0 size-full object-contain transition-opacity duration-(--dur-base) motion-reduce:transition-none",
                working ? "opacity-40" : "group-hover/tile:opacity-90",
              )}
            />
          ) : null}
          {working ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader
                aria-hidden
                strokeWidth={1.5}
                className="size-8 animate-spin text-label motion-reduce:animate-none"
              />
            </div>
          ) : !tile.posterFileId ? (
            <div className="absolute inset-0 flex items-center justify-center text-label-3">
              {attention ? (
                <TriangleAlert aria-hidden strokeWidth={1.25} className="size-8 text-orange" />
              ) : (
                <Film aria-hidden strokeWidth={1.25} className="size-8" />
              )}
            </div>
          ) : null}
          {review ? (
            <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-capsule bg-accent px-2.5 py-1 text-callout font-semibold text-on-accent shadow-float">
              <Eye aria-hidden strokeWidth={2} className="size-(--icon-sm)" />
              {CLIP_STATE_LABELS[tile.stage]}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1 px-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-callout text-label-2 tabular-nums">
              {shotNumber(tile.orderIndex)}
            </span>
            <span className="line-clamp-2 min-w-0 text-headline text-label">{title}</span>
          </span>
          {review ? null : <ClipState stage={tile.stage} />}
        </div>
      </Link>
    </li>
  );
}
