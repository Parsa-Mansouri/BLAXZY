import type { CSSProperties } from "react";
import Link from "next/link";
import type { ProductionBlock } from "@/server/production";
import { ActionMenu, ActionMenuButton, Skeleton, StatusLine, formatDurationLong } from "@/ui";
import { navActions } from "@/app/(app)/_lib/nav-actions";
import { AssetThumb } from "../../_components/asset-thumb";
import { Settle } from "../../_components/feedback";
import { blockHref } from "../../../_lib/production-routes";
import { BLOCK_STATE_TONES, blockStateLabel, scriptChangeNotice } from "../_lib/block-state";
import { Mono } from "@/app/(app)/_components/values";

const SHOWN_THUMBS = 3;

/** A row still loading (Show More Shots): the same shape, as grey bars. */
export function PendingBlockRow() {
  return (
    <li aria-hidden className="flex items-center gap-5 px-3.5 py-3">
      <Skeleton className="h-4 w-6 rounded-paper" />
      <Skeleton className="h-5 max-w-80 flex-1 rounded-paper" />
      <Skeleton className="h-10 w-16 rounded-paper max-sm:hidden" />
      <Skeleton className="h-4 w-28 rounded-paper max-sm:hidden" />
    </li>
  );
}

/**
 * One shot in story order: its number and title, its sheets, its length and its state. A shot a
 * script edit sent back through preparation carries a plain notice under its title.
 */
export function BlockRow({
  projectId,
  block,
  settle = false,
  className,
  style,
}: {
  projectId: string;
  block: ProductionBlock;
  /** The state just changed (Approve All): it settles in. */
  settle?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const shown = block.assets.slice(0, SHOWN_THUMBS);
  const more = block.assets.length - shown.length;
  const number = block.orderIndex + 1;
  const title = block.title ?? `Shot ${number}`;
  const notice = scriptChangeNotice(block);
  const href = blockHref(projectId, block.lineageId);
  return (
    <li className={className} style={style}>
      <ActionMenu actions={navActions(href)} label={`Actions for ${title}`} className="relative">
        <Link
          href={href}
          className="flex press flex-wrap items-center gap-x-5 gap-y-3 rounded-row py-3 pr-12 pl-3.5 focus-ring hover:bg-fill-4 sm:flex-nowrap"
        >
          <span className="flex min-w-0 flex-[1_1_240px] items-baseline gap-3">
            <span className="w-6 shrink-0 text-meta text-label-2 tabular-nums">{number}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="line-clamp-2 text-row font-medium text-pretty break-words">
                {title}
              </span>
              <span className="text-secondary text-label-2">
                {block.durationSeconds ? (
                  <Mono>{formatDurationLong(block.durationSeconds)}</Mono>
                ) : (
                  "No length set"
                )}
              </span>
              {notice ? (
                <span className="text-secondary text-pretty text-label">{notice}</span>
              ) : null}
            </span>
          </span>
          {/* On a phone the frames narrow to fit the row instead of widening the page. */}
          <span
            aria-hidden
            className="flex max-w-full min-w-0 shrink-0 items-center gap-1.5 max-sm:ml-9"
          >
            {shown.length > 0 ? (
              shown.map((asset) => (
                <AssetThumb
                  key={asset.ref}
                  fileId={asset.thumbnailFileId}
                  className="h-10 w-16 min-w-0 shrink"
                />
              ))
            ) : (
              <AssetThumb fileId={null} className="h-10 w-16" />
            )}
            {more > 0 ? (
              <span className="shrink-0 pl-1 text-meta text-label-2 tabular-nums">+{more}</span>
            ) : null}
          </span>
          <Settle settleKey={block.stage} settle={settle} className="w-36 shrink-0 max-sm:ml-9">
            <StatusLine as="span" tone={BLOCK_STATE_TONES[block.stage]} className="flex-nowrap">
              {blockStateLabel(block.stage)}
            </StatusLine>
          </Settle>
        </Link>
        <ActionMenuButton
          actions={navActions(href)}
          label={`More for ${title}`}
          className="absolute top-3 right-2"
        />
      </ActionMenu>
    </li>
  );
}
