"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, PageHeader, ProgressBar, StatusDot } from "@/ui";
import { usePolling } from "@/app/(app)/_lib/use-polling";
import { splitScenes } from "../_lib/scenes";
import { pollScript } from "@/app/(app)/_lib/poll-client";
import { retryVersionAction } from "../actions";
import { ReadingSheet } from "./screenplay-sheet";
import type { VersionView } from "./version-types";

type Source = VersionView["source"];

const WORKING_DESCRIPTION: Record<Source, string> = {
  generated: "Written from your description and the style you chose.",
  uploaded: "Your script is checked for format, length and anything hard to film.",
  revised: "Revised from your comments and the changes you asked for.",
  edited: "Your edits are being saved.",
  enhanced: "Your idea is expanded into a fuller story in the genre and look you chose.",
};

const WORKING_HEADING: Record<Source, string> = {
  generated: "Your script is being written.",
  uploaded: "Your script is being read.",
  revised: "Your script is being revised.",
  edited: "Your script is being saved.",
  enhanced: "Your idea is being expanded.",
};

const WORKING_STATUS: Record<Source, string> = {
  generated: "Writing the script",
  uploaded: "Reading your script",
  revised: "Revising the script",
  edited: "Saving the script",
  enhanced: "Expanding your idea",
};

const FAILED_HEADING: Record<Source, string> = {
  generated: "The script could not be written.",
  uploaded: "Your script could not be read.",
  revised: "The script could not be revised.",
  edited: "The script could not be saved.",
  enhanced: "Your idea could not be expanded.",
};

/**
 * Polls until the latest version leaves `pending`, then refreshes the page. It also refreshes
 * when the project's title changed (Claude named an untitled project from this first story), so
 * the toolbar and sidebar show the name without waiting for the script.
 */
function useRefreshWhenDone(projectId: string, versionId: string, title: string) {
  const router = useRouter();
  usePolling(async (isActive, signal) => {
    const poll = await pollScript(projectId, { signal });
    if (!isActive()) return;
    // No answer (signed out, rate limited, a failed poll) is not a change.
    if (!poll) return;
    if (poll.versionId !== versionId || poll.status !== "pending" || poll.title !== title) {
      router.refresh();
    }
  }, true);
}

/** "What you asked for": the description the script is written from. */
function AskedFor({ brief }: { brief: string }) {
  return (
    <section aria-labelledby="asked-for" className="mt-auto flex in-3 flex-col gap-3 pt-16">
      <h2 id="asked-for" className="text-section text-balance">
        What You Asked For
      </h2>
      <p className="max-w-(--measure) text-body text-pretty break-words whitespace-pre-wrap text-label-2">
        {brief}
      </p>
    </section>
  );
}

export function ScriptWorking({
  projectId,
  projectTitle,
  version,
  previous,
}: {
  projectId: string;
  projectTitle: string;
  version: VersionView;
  /** The version being revised, still readable while the revision is written. */
  previous: VersionView | null;
}) {
  useRefreshWhenDone(projectId, version.id, projectTitle);
  const status = WORKING_STATUS[version.source];
  const previousContent = previous?.content ?? "";
  const previousScenes = useMemo(() => splitScenes(previousContent), [previousContent]);

  return (
    <>
      <PageHeader title="Script" description={WORKING_DESCRIPTION[version.source]} />
      {/* The heading says what is happening; the bar shows it moving (no status line repeating it). */}
      <section aria-labelledby="working" className="flex in-2 flex-col gap-6">
        <h2 id="working" role="status" className="max-w-[24ch] text-heading text-balance">
          {version.writingSegments
            ? "Your script is being written, one part of the outline at a time."
            : WORKING_HEADING[version.source]}
        </h2>
        <ProgressBar value={null} aria-label={status} className="max-w-(--measure)" />
        <p className="max-w-(--measure) text-body text-pretty text-label-2">
          You can leave this page. The script will be here when you return.
        </p>
      </section>

      {(version.source === "generated" || version.source === "enhanced") && version.brief ? (
        <AskedFor brief={version.brief} />
      ) : null}

      {previous && previousScenes.length > 0 ? (
        <section aria-labelledby="previous-version" className="mt-16 flex in-3 flex-col gap-6">
          <h2 id="previous-version" className="text-section text-balance">
            The Version Being Revised
          </h2>
          <ReadingSheet aria-label="Previous version" scenes={previousScenes} />
        </section>
      ) : null}
    </>
  );
}

export function ScriptFailed({
  projectId,
  version,
  onStartOver,
}: {
  projectId: string;
  version: VersionView;
  onStartOver: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fromBrief = version.source === "generated" || version.source === "enhanced";

  function retry() {
    setError(null);
    startTransition(async () => {
      const result = await retryVersionAction(projectId, version.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <>
      <PageHeader
        title="Script"
        description={
          fromBrief ? "Nothing was lost; your description is kept below." : "Nothing was lost."
        }
      />
      <section role="alert" className="flex in-2 flex-col gap-8">
        <div className="flex flex-col gap-3">
          {/* The dot sits on the first line's optical centre; the text below lines up with the words. */}
          <h2 className="flex items-baseline gap-4 text-heading">
            <StatusDot tone="failed" className="size-2.5 -translate-y-1" />
            <span className="max-w-[24ch] text-balance">{FAILED_HEADING[version.source]}</span>
          </h2>
          <p className="max-w-(--measure) pl-6.5 text-body text-pretty text-label-2">
            {version.failure ?? "It stopped before it was finished. Try again in a moment."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 pl-6.5">
          <Button variant="primary" size="large" onClick={onStartOver} disabled={pending}>
            {fromBrief ? "Change the Description" : "Start Over"}
          </Button>
          <Button variant="outlined" size="large" loading={pending} onClick={retry}>
            Try Again
          </Button>
        </div>
        {error ? <p className="swap-in pl-6.5 text-secondary text-red">{error}</p> : null}
      </section>

      {fromBrief && version.brief ? <AskedFor brief={version.brief} /> : null}
    </>
  );
}
