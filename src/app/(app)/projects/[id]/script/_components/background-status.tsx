"use client";

import { useState, useTransition } from "react";
import { Button, StatusLine } from "@/ui";
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

/**
 * The background work after acceptance runs quietly; it only speaks up when it failed, with the
 * way out.
 */
export function BackgroundFailure({
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

  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <StatusLine tone="failed">The shots could not be prepared</StatusLine>
      {status.failure ? <p className="text-secondary text-label-2">{status.failure}</p> : null}
      <Button
        variant="outlined"
        size="small"
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
      {error ? <p className="text-secondary text-red">{error}</p> : null}
    </div>
  );
}
