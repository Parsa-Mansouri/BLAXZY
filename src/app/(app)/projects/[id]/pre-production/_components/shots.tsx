"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Badge, Button, ProgressBar, formatDurationLong } from "@/ui";
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
    <div role="status" aria-live="polite" className="flex max-w-sm flex-col gap-2.5">
      <p className="text-body text-label">Preparing characters, places and shots…</p>
      <ProgressBar value={null} aria-label="Preparing pre-production" />
      <p className="text-callout text-label-2">This page updates on its own when they are ready.</p>
    </div>
  );
}

function Shot({ shot, number }: { shot: ShotRow; number: number }) {
  return (
    <li className="flex flex-col gap-3 py-5 hairline-b">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="w-7 shrink-0 text-callout text-label-2 tabular-nums">{number}</span>
        <h4 className="min-w-0 flex-1 text-title-3">{shot.title ?? `Shot ${number}`}</h4>
        {shot.stale ? (
          <Badge tone="warning" title={shot.staleReason ?? undefined}>
            Out of Date
          </Badge>
        ) : null}
        {shot.durationSeconds ? (
          <span className="text-callout text-label-2 tabular-nums">
            {formatDurationLong(shot.durationSeconds)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 pl-10 max-sm:pl-0">
        <p className="line-clamp-6 max-w-(--measure) text-reading whitespace-pre-line text-label-2">
          {shot.scriptExcerpt}
        </p>
        <details className="group max-w-(--measure)">
          <summary className="inline-flex cursor-default list-none items-center gap-1 rounded-control text-body text-label focus-ring select-none hover:text-label-2 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="size-(--icon-sm) transition-transform duration-(--dur-fast) group-open:rotate-90 motion-reduce:transition-none"
            />
            Prompt
          </summary>
          <p className="pt-2 pl-5 text-reading whitespace-pre-wrap text-label-2">{shot.prompt}</p>
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
      <ol className="flex flex-col">
        {shots.map((shot, i) => (
          <Shot key={shot.id} shot={shot} number={i + 1} />
        ))}
      </ol>
      {cursor ? (
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
