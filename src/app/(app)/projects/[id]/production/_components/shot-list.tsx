"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Button, SelectRow, StatusDot, stagger, type StatusTone } from "@/ui";

export interface ShotListItem {
  lineageId: string;
  orderIndex: number;
  title: string | null;
  href: string;
  tone: StatusTone;
  /** The state in words, read by screen readers; shown only when `note` is set. */
  status: string;
  /** A few visible words beside the dot, only for states worth reading at a glance. */
  note?: string;
}

/**
 * The shots of the film in story order, as the list on the left of a review screen. The row
 * being reviewed has its fill wiped in; every row jumps straight to its shot (no forced Next).
 */
export function ShotList({
  items,
  activeId,
  nextCursor,
  loading,
  onMore,
  error,
}: {
  items: ShotListItem[];
  activeId: string | null;
  nextCursor: string | null;
  loading: boolean;
  onMore: () => void;
  error?: string | null;
}) {
  return (
    <>
      <ol className="flex flex-col gap-0.5">
        {items.map((item, i) => {
          const title = item.title?.trim() || `Shot ${item.orderIndex + 1}`;
          return (
            <li key={item.lineageId} className="enter" style={stagger(Math.min(i, 12))}>
              <SelectRow
                size="regular"
                active={item.lineageId === activeId}
                render={<Link href={item.href} />}
                label={
                  <span className="flex min-w-0 items-baseline gap-2.5">
                    <span className="shrink-0 text-meta text-label-2 tabular-nums">
                      {item.orderIndex + 1}
                    </span>
                    <span className="min-w-0 break-words">{title}</span>
                  </span>
                }
                trailing={<RowStatus tone={item.tone} status={item.status} note={item.note} />}
              />
            </li>
          );
        })}
      </ol>
      {nextCursor ? (
        <div className="px-1.5 pt-3">
          <Button size="small" onClick={onMore} loading={loading}>
            Show More Shots
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="px-3.5 pt-2 text-secondary text-failed">
          {error}
        </p>
      ) : null}
    </>
  );
}

function RowStatus({
  tone,
  status,
  note,
}: {
  tone: StatusTone;
  status: string;
  note?: string;
}): ReactNode {
  return (
    <span className="flex items-center gap-2">
      {note ? <span className="font-mono">{note}</span> : <span className="sr-only">{status}</span>}
      <StatusDot tone={tone} className="size-2" />
    </span>
  );
}
