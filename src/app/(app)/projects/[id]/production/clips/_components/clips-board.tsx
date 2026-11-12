"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, FeatureBlock, PageHeader, StatusLine, stagger } from "@/ui";
import { usePolling } from "../../../_lib/use-polling";
import { finishProductionAction, loadBoardAction, refreshBoardAction } from "../actions";
import type { BoardPage } from "../_lib/clip-data";
import {
  isUnsettled,
  shotsHint,
  statusLine,
  statusTone,
  type Orientation,
} from "../_lib/clip-view";
import { blocksHref, clipHref, finishedHref } from "../_lib/routes";
import { useCreditWatch } from "../../../../../_lib/credits";
import { ClipTile, BoardGrid, FEW_POSTERS } from "./clip-tile";
import { FillPage } from "../../_components/fill-page";
import { useClips } from "./clips-context";

const FAST_POLL_MS = 2000;
const SETTLED_POLL_MS = 10000;

/**
 * The board: every shot as a poster card in story order, one status line that says what needs
 * the user, and the one next step. Finishing the film, once every shot is final, leads as a
 * white block above the posters.
 */
export function ClipsBoard({
  projectId,
  orientation,
  initial,
}: {
  projectId: string;
  orientation: Orientation;
  initial: BoardPage;
}) {
  const router = useRouter();
  const { announce, markArrival, takeArrival } = useClips();
  const [board, setBoard] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setBoard(initial);
  }
  const [error, setError] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [finishing, startFinishing] = useTransition();
  const loadingRef = useRef(false);
  const statusRef = useRef<HTMLDivElement>(null);

  const { tiles, nextCursor, summary } = board;
  const line = statusLine(summary.counts);
  const rendering = tiles.some((t) => isUnsettled(t.stage));
  // Drafts and finals reserve their credits as their jobs start, and refund them if they fail.
  useCreditWatch(rendering);

  // Reached by moving on automatically (no other shot waits): start at the status line.
  useEffect(() => {
    if (takeArrival()) statusRef.current?.focus({ preventScroll: true });
  }, [takeArrival]);

  // Read the new status line out when it changes (not the one the page opened with).
  const lastLine = useRef(line);
  useEffect(() => {
    if (lastLine.current === line) return;
    lastLine.current = line;
    announce(line);
  }, [announce, line]);

  usePolling(
    async (isActive) => {
      if (loadingRef.current) return;
      const result = await refreshBoardAction(projectId, tiles.length);
      if (!isActive() || !result.ok || loadingRef.current) return;
      setBoard(result.data);
    },
    true,
    rendering ? FAST_POLL_MS : SETTLED_POLL_MS,
  );

  function more() {
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
          tiles: [...current.tiles, ...result.data.tiles],
          nextCursor: result.data.nextCursor,
          summary: result.data.summary,
        }));
      } finally {
        loadingRef.current = false;
      }
    });
  }

  function finish() {
    setFinishError(null);
    startFinishing(async () => {
      const result = await finishProductionAction(projectId);
      if (!result.ok) {
        setFinishError(result.error);
        return;
      }
      markArrival();
      router.push(finishedHref(projectId));
    });
  }

  function headerAction() {
    if (summary.canComplete) return null;
    if (summary.allFinal) {
      return (
        <Button variant="primary" size="large" render={<Link href={finishedHref(projectId)} />}>
          {summary.finished ? "View Finished Film" : "Continue"}
        </Button>
      );
    }
    if (summary.firstToReview) {
      return (
        <Button
          variant="primary"
          size="large"
          render={<Link href={clipHref(projectId, summary.firstToReview)} />}
        >
          Review Next
        </Button>
      );
    }
    return null;
  }

  const anyRendering =
    summary.counts.draft_generating + summary.counts.final_generating + summary.counts.preparing >
    0;
  const hint = shotsHint(summary.counts);
  // Some clips are final while others are still made (a reopened film, or on the way).
  const someFinal = summary.counts.done > 0 && !summary.allFinal;

  return (
    <FillPage>
      <PageHeader
        title="Clips"
        description={
          <div ref={statusRef} tabIndex={-1} className="flex flex-col gap-2 outline-none">
            <StatusLine tone={statusTone(summary.counts)}>{line}</StatusLine>
            {hint ? (
              <p className="max-w-(--measure) text-body text-pretty text-label-2">
                {hint}{" "}
                <Link
                  href={blocksHref(projectId)}
                  className="rounded-row text-label underline underline-offset-2 focus-ring"
                >
                  Open Shots
                </Link>
              </p>
            ) : null}
            {anyRendering ? (
              <p className="max-w-(--measure) text-body text-label-2">
                Clips appear here as they finish. You can leave this page.
              </p>
            ) : null}
          </div>
        }
        actions={
          someFinal || headerAction() ? (
            <>
              {someFinal ? (
                <Button size="large" render={<Link href={finishedHref(projectId)} />}>
                  Final Clips
                </Button>
              ) : null}
              {headerAction()}
            </>
          ) : undefined
        }
      />

      {summary.canComplete ? (
        <div className="mb-12 flex in-2 flex-col gap-3">
          <FeatureBlock
            className="w-full"
            title="Finish the Film"
            description="Every shot is final. Finish to download every clip, one by one or together."
            cta={finishing ? "Finishing…" : "Finish"}
            disabled={finishing}
            aria-busy={finishing || undefined}
            onClick={finish}
          />
          {finishError ? (
            <p role="alert" className="max-w-(--measure) text-secondary text-failed">
              {finishError}
            </p>
          ) : null}
        </div>
      ) : null}

      <section aria-label="Every shot" className="flex in-3 flex-col gap-8">
        <BoardGrid orientation={orientation} few={tiles.length <= FEW_POSTERS && !nextCursor}>
          {tiles.map((tile, i) => (
            <ClipTile
              key={tile.lineageId}
              projectId={projectId}
              tile={tile}
              orientation={orientation}
              className="enter"
              style={stagger(Math.min(i, 12))}
            />
          ))}
        </BoardGrid>

        {nextCursor ? (
          <div>
            <Button size="small" onClick={more} loading={loading}>
              Show More Shots
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-secondary text-failed">
            {error}
          </p>
        ) : null}
      </section>
    </FillPage>
  );
}
