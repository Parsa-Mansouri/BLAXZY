"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, StatusLine } from "@/ui";
import type { BackgroundStatus } from "../../_lib/background-status";
import { productionHref } from "../../_lib/production-routes";
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
  const router = useRouter();
  usePolling(async (isActive) => {
    const next = await backgroundStatusAction(projectId, acceptedId);
    if (!isActive() || !next) return;
    setStatus(next);
    // Cutting the shots can reopen a finished film: show the stage as it is now.
    if (next.state !== "running") router.refresh();
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

/**
 * After a script edit: how many shots it changed, with the way to Production where they are
 * prepared again. Nothing when the edit changed none.
 */
export function EditChangedNotice({
  projectId,
  status,
}: {
  projectId: string;
  status: BackgroundStatus;
}) {
  if (status.state !== "done" || status.resetBlocks <= 0) return null;
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-start gap-2">
      <p className="text-secondary text-label-2">
        {status.resetBlocks === 1
          ? "The edit changed 1 shot. It is prepared again in Production."
          : `The edit changed ${status.resetBlocks} shots. They are prepared again in Production.`}
      </p>
      <Button variant="outlined" size="small" render={<Link href={productionHref(projectId)} />}>
        Open Production
      </Button>
    </div>
  );
}
