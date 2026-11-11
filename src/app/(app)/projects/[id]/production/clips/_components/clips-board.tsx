"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/ui";
import { usePolling } from "../../../_lib/use-polling";
import { finishProductionAction, loadBoardAction, refreshBoardAction } from "../actions";
import type { BoardPage } from "../_lib/clip-data";
import { isUnsettled, shotsHint, statusLine, type Orientation } from "../_lib/clip-view";
import { blocksHref, clipHref, finishedHref } from "../_lib/routes";
import { ClipTile, BoardGrid } from "./clip-tile";
import { useClips, useShown, StateHeading } from "./clips-context";
import { useCreditWatch } from "../../../../../_lib/credits";

const FAST_POLL_MS = 2000;
const SETTLED_POLL_MS = 10000;

/** The board: every shot as a poster tile, one status line, and the one next step. */
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
  const { announce, markArrival } = useClips();
  const shown = useShown();
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

  const { tiles, nextCursor, summary } = board;
  const line = statusLine(summary.counts);
  const rendering = tiles.some((t) => isUnsettled(t.stage));
  // Drafts and finals reserve their credits as their jobs start, and refund them if they fail.
  useCreditWatch(rendering);

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

  function nextStep() {
    if (summary.canComplete) {
      return (
        <Button variant="prominent" size="large" loading={finishing} onClick={finish}>
          Finish
        </Button>
      );
    }
    if (summary.allFinal) {
      return (
        <Button variant="prominent" size="large" render={<Link href={finishedHref(projectId)} />}>
          {summary.finished ? "View Finished Film" : "Continue"}
        </Button>
      );
    }
    if (summary.firstToReview) {
      return (
        <Button
          variant="prominent"
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
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="flex min-w-0 flex-col gap-2">
          <StateHeading shown={shown} className="text-large-title">
            Clips
          </StateHeading>
          <p className="text-reading text-label tabular-nums">{line}</p>
          {hint ? (
            <p className="max-w-(--measure) text-reading text-pretty text-label-2">
              {hint}{" "}
              <Link
                href={blocksHref(projectId)}
                className="rounded-control text-label underline underline-offset-2 focus-ring"
              >
                Open Shots
              </Link>
            </p>
          ) : null}
          {anyRendering ? (
            <p className="max-w-(--measure) text-reading text-pretty text-label-2">
              Clips appear here as they finish. You can leave this page.
            </p>
          ) : summary.canComplete ? (
            <p className="max-w-(--measure) text-reading text-pretty text-label-2">
              Finish to download every clip, one by one or together.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {someFinal ? (
              <Button render={<Link href={finishedHref(projectId)} />}>Final Clips</Button>
            ) : null}
            {nextStep()}
          </div>
          {finishError ? (
            <p role="alert" className="max-w-80 text-callout text-red">
              {finishError}
            </p>
          ) : null}
        </div>
      </header>

      <BoardGrid orientation={orientation}>
        {tiles.map((tile) => (
          <ClipTile
            key={tile.lineageId}
            projectId={projectId}
            tile={tile}
            orientation={orientation}
          />
        ))}
      </BoardGrid>

      {nextCursor ? (
        <div>
          <Button onClick={more} loading={loading}>
            Load More
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-callout text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
