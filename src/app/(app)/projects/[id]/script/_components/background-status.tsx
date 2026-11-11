"use client";

import { useState, useTransition } from "react";
import { Button, ProgressBar } from "@/ui";
import { describeAssetCounts } from "../../_lib/asset-kinds";
import type { BackgroundStatus } from "../../_lib/background-status";
import { usePolling } from "../../_lib/use-polling";
import { backgroundStatusAction, retrySectioningAction } from "../actions";

/** Live status of what runs after acceptance; polls while it runs. */
export function useBackgroundStatus(
  projectId: string,
  acceptedId: string | null,
  initial: BackgroundStatus | null,
) {
  const [status, setStatus] = useState(initial);
  const [seen, setSeen] = useState(initial);
  // A fresh server render (after an edit or a retry) replaces the local copy.
  if (initial !== seen) {
    setSeen(initial);
    setStatus(initial);
  }
  usePolling(async (isActive) => {
    const next = await backgroundStatusAction(projectId, acceptedId);
    if (isActive() && next) setStatus(next);
  }, status?.state === "running");
  return [status, setStatus] as const;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Finding characters, places and props…", then "Preparing shots…", then what is ready. */
export function BackgroundStatusView({
  projectId,
  status,
  onRetried,
}: {
  projectId: string;
  status: BackgroundStatus;
  onRetried: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const found = describeAssetCounts(status.counts);

  if (status.state === "running") {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-2.5">
        <p className="text-body text-label">
          {status.detected ? "Preparing shots…" : "Finding characters, places and props…"}
        </p>
        <ProgressBar value={null} aria-label="Preparing pre-production" />
        {status.detected && found ? (
          <p className="text-callout text-label-2">Found {found}.</p>
        ) : null}
        <p className="text-callout text-label-2">
          This runs in the background. You can continue now.
        </p>
      </div>
    );
  }

  if (status.state === "failed") {
    return (
      <div role="alert" className="flex flex-col gap-2.5">
        <p className="text-body text-label">The shots could not be prepared.</p>
        <p className="text-callout text-label-2">
          {status.failure ?? "Something went wrong in the background."}
        </p>
        <div>
          <Button
            loading={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await retrySectioningAction(projectId);
                if (!result.ok) setError(result.error);
                else onRetried();
              });
            }}
          >
            Try Again
          </Button>
        </div>
        {error ? <p className="text-callout text-red">{error}</p> : null}
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-1.5">
      <p className="text-body text-label">
        {status.blockCount > 0
          ? `${plural(status.blockCount, "shot", "shots")} ready.`
          : "Nothing has been prepared yet."}
      </p>
      {found ? <p className="text-callout text-label-2">Found {found}.</p> : null}
      {status.state === "stale" ? (
        <p className="text-callout text-orange">
          Some shots no longer match the script and will be prepared again.
        </p>
      ) : null}
    </div>
  );
}
