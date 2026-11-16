"use client";

import Link from "next/link";
import {
  ActionMenu,
  ActionMenuButton,
  Button,
  SelectRow,
  Skeleton,
  StatusDot,
  stagger,
  type StatusTone,
} from "@/ui";
import { navActions } from "@/app/(app)/_lib/nav-actions";
import { DrawnTick, Settle, useChangedKeys } from "./feedback";

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
 * A done shot carries a tick, which draws in when the shot was just approved or accepted; any
 * other change of state settles in with a short fade.
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
  const changed = useChangedKeys(items.map((item) => [item.lineageId, item.tone] as const));
  return (
    <>
      <ol className="flex flex-col gap-0.5">
        {items.map((item, i) => {
          const title = item.title?.trim() || `Shot ${item.orderIndex + 1}`;
          return (
            <li key={item.lineageId} className="enter" style={stagger(Math.min(i, 12))}>
              <ActionMenu
                actions={navActions(item.href)}
                label={`Actions for ${title}`}
                className="relative"
              >
                <SelectRow
                  size="regular"
                  className="pr-12"
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
                  trailing={<RowStatus item={item} settle={changed.has(item.lineageId)} />}
                />
                <ActionMenuButton
                  actions={navActions(item.href)}
                  label={`More for ${title}`}
                  className="absolute top-1/2 right-2 -translate-y-1/2"
                />
              </ActionMenu>
            </li>
          );
        })}
        {loading ? (
          <li aria-hidden className="flex min-h-14 items-center gap-3 px-3.5">
            <Skeleton className="h-4 w-4 rounded-paper" />
            <Skeleton className="h-4 flex-1 rounded-paper" />
          </li>
        ) : null}
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

function RowStatus({ item, settle }: { item: ShotListItem; settle: boolean }) {
  return (
    <Settle settleKey={item.tone} settle={settle} className="items-center gap-2">
      {item.note ? <span>{item.note}</span> : <span className="sr-only">{item.status}</span>}
      {item.tone === "done" ? (
        <DrawnTick draw={settle} />
      ) : (
        <StatusDot tone={item.tone} className="size-2" />
      )}
    </Settle>
  );
}
