"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, PageHeader, ProgressBar, StatusDot, StatusLine } from "@/ui";
import { usePolling } from "../../_lib/use-polling";
import { splitScenes } from "../_lib/scenes";
import { pollScriptAction, retryVersionAction } from "../actions";
import { ReadingSheet } from "./screenplay-sheet";
import type { VersionView } from "./shared";

type Source = VersionView["source"];

const WORKING_DESCRIPTION: Record<Source, string> = {
  generated: "Written from your description and the style you chose.",
  uploaded: "Your script is checked for format, length and anything hard to film.",
  revised: "Revised from your comments and the changes you asked for.",
  edited: "Your edits are being saved.",
};

const WORKING_HEADING: Record<Source, string> = {
  generated: "Your script is being written.",
  uploaded: "Your script is being read.",
  revised: "Your script is being revised.",
  edited: "Your script is being saved.",
};

const WORKING_STATUS: Record<Source, string> = {
  generated: "Writing the script",
  uploaded: "Reading your script",
  revised: "Revising the script",
  edited: "Saving the script",
};

const FAILED_HEADING: Record<Source, string> = {
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

/** "What you asked for": the description the script is written from. */
function AskedFor({ brief }: { brief: string }) {
  return (
    <section
      aria-labelledby="asked-for"
      className="mt-auto flex in-3 flex-col gap-3 pt-6 hairline-t"
    >
      <h2 id="asked-for" className="text-section">
        What You Asked For
      </h2>
      <p className="max-w-[70ch] text-body whitespace-pre-wrap text-label-2">{brief}</p>
    </section>
  );
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
  const status = WORKING_STATUS[version.source];
  const previousContent = previous?.content ?? "";
  const previousScenes = useMemo(() => splitScenes(previousContent), [previousContent]);

  return (
    <>
      <PageHeader title="Script" description={WORKING_DESCRIPTION[version.source]} />
      <section aria-labelledby="working" className="mb-16 flex in-2 flex-col gap-6">
        <h2 id="working" className="text-heading text-balance">
          {WORKING_HEADING[version.source]}
        </h2>
        <div className="flex flex-col gap-3">
          <ProgressBar value={null} aria-label={status} />
          <div role="status" aria-live="polite">
            <StatusLine tone="working">{status}</StatusLine>
          </div>
        </div>
        <p className="max-w-[56ch] text-body text-label-2">
          You can leave this page. The script will be here when you return.
        </p>
      </section>

      {version.source === "generated" && version.brief ? <AskedFor brief={version.brief} /> : null}

      {previous && previousScenes.length > 0 ? (
        <section
          aria-labelledby="previous-version"
          className="mt-16 flex in-3 flex-col gap-6 pt-6 hairline-t"
        >
          <h2 id="previous-version" className="text-section">
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
  const fromBrief = version.source === "generated";

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
      <section role="alert" className="mb-16 flex in-2 flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h2 className="flex items-baseline gap-4 text-heading">
            <StatusDot tone="failed" className="size-2.5 -translate-y-1" />
            <span className="text-balance">{FAILED_HEADING[version.source]}</span>
          </h2>
          <p className="max-w-[56ch] pl-6.5 text-body text-label-2">
            {version.failure ?? "Something went wrong while it was being prepared."}
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
        {error ? <p className="pl-6.5 text-secondary text-red">{error}</p> : null}
      </section>

      {fromBrief && version.brief ? <AskedFor brief={version.brief} /> : null}
    </>
  );
}
