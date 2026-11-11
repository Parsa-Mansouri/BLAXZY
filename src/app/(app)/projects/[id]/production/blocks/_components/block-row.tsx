import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ProductionBlock } from "@/server/production";
import { formatDurationLong } from "@/ui";
import { AssetThumb } from "../../_components/asset-thumb";
import { blockHref } from "../../../_lib/production-routes";
import { scriptChangeNotice } from "../_lib/block-state";
import { BlockStateLabel } from "./block-state-label";

const SHOWN_THUMBS = 3;

/** One shot in story order: its sheets lead, then the title, the length and the state. */
export function BlockRow({ projectId, block }: { projectId: string; block: ProductionBlock }) {
  const shown = block.assets.slice(0, SHOWN_THUMBS);
  const more = block.assets.length - shown.length;
  const number = block.orderIndex + 1;
  const title = block.title ?? `Shot ${number}`;
  const notice = scriptChangeNotice(block);
  return (
    <li>
      <Link
        href={blockHref(projectId, block.lineageId)}
        className="group/row flex flex-col gap-3 py-4 hairline-b focus-ring focus-visible:rounded-artwork focus-visible:outline-offset-4 sm:flex-row sm:items-center sm:gap-5"
      >
        {/* On a phone the frames narrow to fit the row instead of widening the page. */}
        <div className="flex h-16 max-w-full min-w-0 shrink-0 items-center gap-1.5 sm:w-[24rem]">
          {shown.length > 0 ? (
            shown.map((asset) => (
              <AssetThumb
                key={asset.ref}
                fileId={asset.thumbnailFileId}
                className="h-16 w-28 min-w-0 shrink transition-opacity duration-(--dur-fast) group-hover/row:opacity-90"
              />
            ))
          ) : (
            <AssetThumb fileId={null} className="h-16 w-28" />
          )}
          {more > 0 ? (
            <span className="shrink-0 pl-1 text-callout text-label-2 tabular-nums">+{more}</span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-title-3">
            <span className="mr-2 text-label-2 tabular-nums">{number}</span>
            {title}
          </span>
          <span className="text-callout text-label-2 tabular-nums">
            {block.durationSeconds ? formatDurationLong(block.durationSeconds) : "No length set"}
          </span>
          {notice ? <span className="text-callout text-orange">{notice}</span> : null}
        </div>
        <div className="flex items-center gap-2 sm:justify-end">
          <BlockStateLabel stage={block.stage} />
          <ChevronRight
            aria-hidden
            className="hidden size-(--icon) text-label-3 transition-transform duration-(--dur-fast) group-hover/row:translate-x-0.5 motion-reduce:transition-none sm:block"
          />
        </div>
      </Link>
    </li>
  );
}
