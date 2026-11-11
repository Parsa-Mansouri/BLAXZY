import type { CSSProperties } from "react";
import Link from "next/link";
import type { ProductionBlock } from "@/server/production";
import { StatusLine, formatDurationLong } from "@/ui";
import { AssetThumb } from "../../_components/asset-thumb";
import { blockHref } from "../../../_lib/production-routes";
import { BLOCK_STATE_TONES, blockStateLabel } from "../_lib/block-state";

const SHOWN_THUMBS = 3;

/** One shot in story order: its number and title, its sheets, its length and its state. */
export function BlockRow({
  projectId,
  block,
  className,
  style,
}: {
  projectId: string;
  block: ProductionBlock;
  className?: string;
  style?: CSSProperties;
}) {
  const shown = block.assets.slice(0, SHOWN_THUMBS);
  const more = block.assets.length - shown.length;
  const number = block.orderIndex + 1;
  const title = block.title ?? `Shot ${number}`;
  return (
    <li className={className} style={style}>
      <Link
        href={blockHref(projectId, block.lineageId)}
        className="flex press flex-wrap items-center gap-x-5 gap-y-3 rounded-row px-3.5 py-3 focus-ring hover:bg-fill-4 sm:flex-nowrap"
      >
        <span className="flex min-w-0 flex-[1_1_240px] items-baseline gap-3">
          <span className="w-6 shrink-0 text-meta text-label-2 tabular-nums">{number}</span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="line-clamp-2 text-row font-medium">{title}</span>
            <span className="text-secondary text-label-2 tabular-nums">
              {block.durationSeconds ? formatDurationLong(block.durationSeconds) : "No length set"}
            </span>
          </span>
        </span>
        <span aria-hidden className="flex shrink-0 items-center gap-1.5 max-sm:ml-9">
          {shown.length > 0 ? (
            shown.map((asset) => (
              <AssetThumb key={asset.ref} fileId={asset.thumbnailFileId} className="h-10 w-16" />
            ))
          ) : (
            <AssetThumb fileId={null} className="h-10 w-16" />
          )}
          {more > 0 ? (
            <span className="pl-1 text-meta text-label-2 tabular-nums">+{more}</span>
          ) : null}
        </span>
        <StatusLine
          as="span"
          tone={BLOCK_STATE_TONES[block.stage]}
          className="w-28 shrink-0 flex-nowrap max-sm:ml-9"
        >
          {blockStateLabel(block.stage)}
        </StatusLine>
      </Link>
    </li>
  );
}
