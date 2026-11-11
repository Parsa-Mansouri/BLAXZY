"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useParams } from "next/navigation";
import type { ProductionBlock } from "@/server/production";
import { PageHeader, StatusLine, SwapFade } from "@/ui";
import { usePolling } from "../../../_lib/use-polling";
import { blockHref } from "../../../_lib/production-routes";
import { FillPage } from "../../_components/fill-page";
import { ReviewLayout } from "../../_components/review-layout";
import { ReviewListContext } from "../../_components/review-list-context";
import { ShotList, type ShotListItem } from "../../_components/shot-list";
import { loadBlocksAction, refreshBlocksAction, type BlocksSnapshot } from "../actions";
import {
  BLOCK_STATE_TONES,
  attentionTone,
  attentionWords,
  blockStateLabel,
} from "../_lib/block-state";

const FAST_POLL_MS = 2000;
const SETTLED_POLL_MS = 10000;

/** Fresh rows replace the ones already shown; rows loaded further down are kept. */
function merge(current: ProductionBlock[], fresh: ProductionBlock[]): ProductionBlock[] {
  const byId = new Map(fresh.map((b) => [b.lineageId, b]));
  const kept = current.filter((b) => !byId.has(b.lineageId));
  return [...fresh, ...kept].sort((a, b) => a.orderIndex - b.orderIndex);
}

function toItem(projectId: string, block: ProductionBlock): ShotListItem {
  const failed = block.stage === "prepare_failed" || block.stage === "failed";
  return {
    lineageId: block.lineageId,
    orderIndex: block.orderIndex,
    title: block.title,
    href: blockHref(projectId, block.lineageId),
    tone: BLOCK_STATE_TONES[block.stage],
    status: blockStateLabel(block.stage),
    note: failed ? "Failed" : block.stage === "preparing" ? "Preparing" : undefined,
  };
}

/**
 * The shot review around one shot: the title and status line stay, the shots are listed on the
 * left (the one under review is selected) and the shot fills the focus area. It lives in the
 * route's layout, so moving from shot to shot only swaps the focus area (250ms fade).
 */
export function BlockReviewFrame({
  projectId,
  initial,
  children,
}: {
  projectId: string;
  initial: BlocksSnapshot;
  children: ReactNode;
}) {
  const params = useParams<{ lineageId?: string }>();
  const activeId = params.lineageId ? decodeURIComponent(params.lineageId) : null;
  const [snapshot, setSnapshot] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setSnapshot((current) => ({ ...initial, items: merge(current.items, initial.items) }));
  }
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const busyRef = useRef(false);

  const { items, nextCursor, counts } = snapshot;

  const refresh = useCallback(
    async (isActive: () => boolean = () => true) => {
      if (busyRef.current) return;
      const result = await refreshBlocksAction(projectId, items.length);
      if (!isActive() || busyRef.current || !result.ok) return;
      setSnapshot((current) => ({
        ...result.data,
        items: merge(current.items, result.data.items),
        nextCursor:
          result.data.items.length >= current.items.length
            ? result.data.nextCursor
            : current.nextCursor,
      }));
    },
    [projectId, items.length],
  );

  usePolling(refresh, true, counts.preparing > 0 ? FAST_POLL_MS : SETTLED_POLL_MS);

  const more = useCallback(() => {
    if (!nextCursor) return;
    setError(null);
    busyRef.current = true;
    startLoading(async () => {
      try {
        const result = await loadBlocksAction(projectId, nextCursor);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSnapshot((current) => ({
          ...result.data,
          items: merge(current.items, result.data.items),
        }));
      } finally {
        busyRef.current = false;
      }
    });
  }, [nextCursor, projectId]);

  // The shot under review may sit further down than the first page: read on until it is listed.
  const found = activeId === null || items.some((b) => b.lineageId === activeId);
  useEffect(() => {
    if (found || !nextCursor || loading || error) return;
    const timer = window.setTimeout(more, 0);
    return () => window.clearTimeout(timer);
  }, [error, found, loading, more, nextCursor]);

  const words = attentionWords(counts);

  return (
    <ReviewListContext.Provider value={() => void refresh()}>
      <FillPage>
        <PageHeader
          title="Shots"
          description={
            words ? (
              <StatusLine tone={attentionTone(counts)} as="div">
                <span role="status" aria-live="polite">
                  {words}
                </span>
              </StatusLine>
            ) : undefined
          }
        />
        <ReviewLayout
          listLabel="Shots"
          list={
            <ShotList
              items={items.map((b) => toItem(projectId, b))}
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
