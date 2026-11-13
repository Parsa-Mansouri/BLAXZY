"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { PageHeader, StatusLine, SwapFade } from "@/ui";
import { useServerSnapshot } from "@/app/(app)/_lib/use-server-snapshot";
import { FAST_POLL_MS, SETTLED_POLL_MS, usePolling } from "@/app/(app)/_lib/use-polling";
import { FillPage } from "../../_components/fill-page";
import { ReviewLayout } from "../../_components/review-layout";
import { ReviewListContext } from "../../_components/review-list-context";
import { ShotList, type ShotListItem } from "../../_components/shot-list";
import { refreshBoard } from "@/app/(app)/_lib/poll-client";
import { loadBoardAction } from "../actions";
import type { BoardPage } from "../_lib/clip-data";
import { mergeBoard } from "../_lib/merge-board";
import {
  CLIP_STATE_LABELS,
  CLIP_STATE_TONES,
  isRendering,
  isUnsettled,
  needsAttention,
  statusLine,
  statusTone,
  type ClipTileData,
} from "../_lib/clip-view";
import { clipHref } from "../_lib/routes";

/** Fresh rows replace the ones already shown; rows loaded further down are kept. */
function merge(current: ClipTileData[], fresh: ClipTileData[]): ClipTileData[] {
  const byId = new Map(fresh.map((t) => [t.lineageId, t]));
  const kept = current.filter((t) => !byId.has(t.lineageId));
  return [...fresh, ...kept].sort((a, b) => a.orderIndex - b.orderIndex);
}

function toItem(projectId: string, tile: ClipTileData): ShotListItem {
  return {
    lineageId: tile.lineageId,
    orderIndex: tile.orderIndex,
    title: tile.title,
    href: clipHref(projectId, tile.lineageId),
    tone: CLIP_STATE_TONES[tile.stage],
    status: CLIP_STATE_LABELS[tile.stage],
    note: needsAttention(tile.stage) ? "Failed" : isRendering(tile.stage) ? "Rendering" : undefined,
  };
}

/**
 * The clip review around one shot: the title and status line stay, the shots are listed on the
 * left (the one under review is selected) and the clip fills the focus area. It lives in the
 * route's layout, so moving from shot to shot only swaps the focus area (250ms fade).
 */
export function ClipReviewFrame({
  projectId,
  initial,
  children,
}: {
  projectId: string;
  initial: BoardPage;
  children: ReactNode;
}) {
  const params = useParams<{ lineageId?: string }>();
  const activeId = params.lineageId ? decodeURIComponent(params.lineageId) : null;
  const [board, setBoard] = useServerSnapshot(initial, mergeBoard);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const loadingRef = useRef(false);

  const { tiles, nextCursor, summary } = board;

  const refresh = useCallback(
    async (isActive: () => boolean = () => true, signal?: AbortSignal) => {
      if (loadingRef.current) return;
      const result = await refreshBoard(projectId, tiles.length, { signal });
      if (!isActive() || !result.ok || loadingRef.current) return;
      setBoard((current) => ({
        ...result.data,
        tiles: merge(current.tiles, result.data.tiles),
        nextCursor:
          result.data.tiles.length >= current.tiles.length
            ? result.data.nextCursor
            : current.nextCursor,
      }));
    },
    [projectId, tiles.length, setBoard],
  );

  const rendering = tiles.some((t) => isUnsettled(t.stage));
  usePolling(refresh, true, rendering ? FAST_POLL_MS : SETTLED_POLL_MS);

  const more = useCallback(() => {
    if (!nextCursor) return;
    setError(null);
    loadingRef.current = true;
    startLoading(async () => {
      try {
        const result = await loadBoardAction(projectId, nextCursor);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setBoard((current) => ({
          tiles: merge(current.tiles, result.data.tiles),
          nextCursor: result.data.nextCursor,
          summary: result.data.summary,
        }));
      } finally {
        loadingRef.current = false;
      }
    });
  }, [nextCursor, projectId, setBoard]);

  // The shot under review may sit further down than the first page: read on until it is listed.
  const found = activeId === null || tiles.some((t) => t.lineageId === activeId);
  useEffect(() => {
    if (found || !nextCursor || loading || error) return;
    const timer = window.setTimeout(more, 0);
    return () => window.clearTimeout(timer);
  }, [error, found, loading, more, nextCursor]);

  return (
    <ReviewListContext.Provider value={() => void refresh()}>
      <FillPage>
        <PageHeader
          title="Clips"
          description={
            <StatusLine tone={statusTone(summary.counts)}>{statusLine(summary.counts)}</StatusLine>
          }
        />
        <ReviewLayout
          listLabel="Shots"
          list={
            <ShotList
              items={tiles.map((t) => toItem(projectId, t))}
              activeId={activeId}
              nextCursor={nextCursor}
              loading={loading}
              onMore={more}
              error={error}
            />
          }
        >
          <SwapFade swapKey={activeId ?? "none"}>{children}</SwapFade>
        </ReviewLayout>
      </FillPage>
    </ReviewListContext.Provider>
  );
}
