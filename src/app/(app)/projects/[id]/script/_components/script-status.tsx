"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ProgressBar } from "@/ui";
import { usePolling } from "../../_lib/use-polling";
import { pollScriptAction, retryVersionAction } from "../actions";
import { ScriptDocument } from "./script-document";
import { sourceLabel, type VersionView } from "./shared";

const WORKING: Record<VersionView["source"], string> = {
  generated: "Writing the script…",
  uploaded: "Reading your script…",
  revised: "Revising the script…",
  edited: "Saving the script…",
};

const FAILED: Record<VersionView["source"], string> = {
  generated: "The script could not be written.",
  uploaded: "Your script could not be read.",
  revised: "The script could not be revised.",
  edited: "The script could not be saved.",
};

/** Polls until the latest version leaves `pending`, then refreshes the page. */
function useRefreshWhenDone(projectId: string, versionId: string) {
  const router = useRouter();
  usePolling(async (isActive) => {
    const poll = await pollScriptAction(projectId);
    if (!isActive()) return;
    if (!poll || poll.versionId !== versionId || poll.status !== "pending") router.refresh();
  }, true);
}

export function ScriptWorking({
  projectId,
  version,
  previous,
}: {
  projectId: string;
  version: VersionView;
  /** The version being revised, still readable while the revision is written. */
  previous: VersionView | null;
}) {
  useRefreshWhenDone(projectId, version.id);
  const label = WORKING[version.source];
  return (
    <div className="flex flex-col gap-14">
      <section role="status" aria-live="polite" className="flex max-w-(--measure) flex-col gap-4">
        <h3 className="text-title-1">{label}</h3>
        <ProgressBar value={null} aria-label={label} className="max-w-sm" />
        <p className="text-reading text-label-2">
          You can leave this page. The script will be here when you return.
        </p>
        {version.source === "generated" && version.brief ? (
          <blockquote className="mt-2 flex flex-col gap-1">
            <span className="text-callout text-label-2">From your description</span>
            <span className="text-script text-pretty text-label">{version.brief}</span>
          </blockquote>
        ) : null}
      </section>

      {previous?.content ? (
        <section aria-labelledby="previous-title" className="flex flex-col gap-6">
          <header className="flex flex-col gap-1 pt-6 hairline-t">
            <h3 id="previous-title" className="text-title-3">
              {previous.title ?? "Previous Version"}
            </h3>
            <p className="text-callout text-label-2">
              Version {previous.versionNumber} · {sourceLabel(previous.source)}. Shown while the
              revision is written.
            </p>
          </header>
          <ScriptDocument
            content={previous.content}
            className="max-w-(--measure) text-label-2"
            aria-label="Previous version"
          />
        </section>
      ) : null}
    </div>
  );
}

export function ScriptFailed({
  projectId,
  version,
  onStartOver,
}: {
  projectId: string;
  version: VersionView;
  onStartOver: (() => void) | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function retry() {
    setError(null);
    startTransition(async () => {
      const result = await retryVersionAction(projectId, version.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <section role="alert" className="flex max-w-(--measure) flex-col gap-4">
      <h3 className="text-title-1">{FAILED[version.source]}</h3>
      <p className="text-reading text-label-2">
        {version.failure ?? "Something went wrong while it was being prepared."} Nothing you wrote
        was lost.
      </p>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button variant="prominent" size="large" loading={pending} onClick={retry}>
          Try Again
        </Button>
        {onStartOver ? (
          <Button size="large" onClick={onStartOver} disabled={pending}>
            Start Over
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-callout text-red">{error}</p> : null}
    </section>
  );
}
