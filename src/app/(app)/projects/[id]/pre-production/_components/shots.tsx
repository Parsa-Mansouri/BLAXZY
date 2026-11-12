"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Button, ProgressBar, Skeleton, StatusLine, formatDurationLong } from "@/ui";
import { usePolling } from "../../_lib/use-polling";
import { loadShotsAction, pollPreProductionAction } from "../actions";
import type { ShotRow } from "./shot-types";

/** Refreshes the page when the background run changes state; polls only while it runs. */
export function PreProductionPoller({
  projectId,
  state,
  blockCount,
}: {
  projectId: string;
  state: string;
  blockCount: number;
}) {
  const router = useRouter();
  usePolling(async (isActive) => {
    const next = await pollPreProductionAction(projectId);
    if (isActive() && next && (next.state !== state || next.blockCount !== blockCount))
      router.refresh();
  }, state === "running");
  if (state !== "running") return null;
  return (
    <div role="status" aria-live="polite" className="mb-8 flex max-w-sm in-2 flex-col gap-3">
      <StatusLine tone="working">Preparing characters, places and shots</StatusLine>
      <ProgressBar value={null} aria-label="Preparing pre-production" />
    </div>
  );
}

function Shot({ shot, number }: { shot: ShotRow; number: number }) {
  return (
    <li className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="w-7 shrink-0 text-meta text-label-2 tabular-nums">{number}</span>
        <h3 className="min-w-0 flex-1 text-row">{shot.title ?? `Shot ${number}`}</h3>
        {shot.stale ? (
          <StatusLine as="span" tone="waiting" className="self-center">
            <span title={shot.staleReason ?? undefined}>Out of date</span>
          </StatusLine>
        ) : null}
        {shot.durationSeconds ? (
          <span className="text-meta text-label-2 tabular-nums">
            {formatDurationLong(shot.durationSeconds)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 pl-10 max-sm:pl-0">
        <p className="line-clamp-6 max-w-(--measure) text-body whitespace-pre-line text-label-2">
          {shot.scriptExcerpt}
        </p>
        <details className="group max-w-(--measure)">
          <summary className="inline-flex cursor-default list-none items-center gap-1 rounded-row text-secondary text-label focus-ring select-none hover:text-label-2 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="size-(--icon) transition-transform duration-(--dur-press) ease-out group-open:rotate-90"
            />
            Prompt
          </summary>
          <p className="pt-2 pl-5 text-body whitespace-pre-wrap text-label-2">{shot.prompt}</p>
        </details>
      </div>
    </li>
  );
}

/** The shots in story order, a page at a time. */
export function ShotList({
  projectId,
  initial,
  initialCursor,
}: {
  projectId: string;
  initial: ShotRow[];
  initialCursor: string | null;
}) {
  const [shots, setShots] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setShots(initial);
    setCursor(initialCursor);
  }

  function more() {
    if (!cursor) return;
    setError(null);
    startLoading(async () => {
      const page = await loadShotsAction(projectId, cursor);
      if (!page.ok) {
        setError(page.error);
        return;
      }
      setShots((list) => [...list, ...page.items]);
      setCursor(page.nextCursor);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-10 pt-4">
        {shots.map((shot, i) => (
          <Shot key={shot.id} shot={shot} number={i + 1} />
        ))}
        {loading ? (
          <li aria-hidden="true" className="flex flex-col gap-3">
            <Skeleton className="h-6 w-1/2 max-w-sm" />
            <Skeleton className="h-16 w-full max-w-(--measure)" />
          </li>
        ) : null}
      </ol>
      {cursor ? (
        <div>
          <Button onClick={more} loading={loading} variant="outlined">
            Load More
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-secondary text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
