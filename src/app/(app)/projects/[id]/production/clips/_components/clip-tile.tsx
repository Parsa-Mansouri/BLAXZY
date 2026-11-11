import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Button, StatusLine, cn } from "@/ui";
import { PosterTile } from "../../_components/poster-tile";
import {
  CLIP_STATE_LABELS,
  CLIP_STATE_TONES,
  isUnsettled,
  needsReview,
  shotNumber,
  shotTitle,
  type ClipTileData,
  type Orientation,
} from "../_lib/clip-view";
import { clipHref } from "../_lib/routes";

/** Class names are literal so Tailwind can see them. */
const COLUMNS: Record<Orientation, string> = {
  landscape: "grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))]",
  portrait: "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]",
};

export function BoardGrid({
  orientation,
  children,
}: {
  orientation: Orientation;
  children: ReactNode;
}) {
  return <ul className={cn("grid gap-x-7 gap-y-10", COLUMNS[orientation])}>{children}</ul>;
}

/**
 * One shot as a poster card. Hovering or focusing it slides up the panel with its one action:
 * Review for a draft or final waiting for the user (white), Open for the rest.
 */
export function ClipTile({
  projectId,
  tile,
  orientation,
  className,
  style,
}: {
  projectId: string;
  tile: ClipTileData;
  orientation: Orientation;
  className?: string;
  style?: CSSProperties;
}) {
  const review = needsReview(tile.stage);
  const working = isUnsettled(tile.stage);
  const title = shotTitle(tile);
  const number = shotNumber(tile.orderIndex);
  const state = CLIP_STATE_LABELS[tile.stage];
  const line = <StatusLine tone={CLIP_STATE_TONES[tile.stage]}>{state}</StatusLine>;
  const href = clipHref(projectId, tile.lineageId);
  return (
    <li className={cn("min-w-0", className)} style={style}>
      <PosterTile
        label={`Shot ${number}, ${title}: ${state}`}
        shape={orientation}
        posterFileId={tile.posterFileId}
        dim={working}
        placeholder={tile.posterFileId ? undefined : working ? "Rendering" : "No clip yet"}
        coverHeading={title}
        coverLine={line}
        actions={
          review ? (
            <Button variant="primary" render={<Link href={href} />}>
              {tile.stage === "final_review" ? "Review Final" : "Review Draft"}
            </Button>
          ) : (
            <Button variant="dark" render={<Link href={href} />}>
              Open
            </Button>
          )
        }
        caption={
          <>
            <span className="mr-2 text-label-2 tabular-nums">{number}</span>
            {title}
          </>
        }
        status={line}
      />
    </li>
  );
}
