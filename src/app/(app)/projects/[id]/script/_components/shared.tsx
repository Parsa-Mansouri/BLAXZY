"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { ScriptVersionSummary, ScriptVersionView } from "@/server/script";
import { cn } from "@/ui";
import { loadVersionAction } from "../actions";

export type VersionView = ScriptVersionView;
export type VersionSummary = ScriptVersionSummary;

export interface IssueChoice {
  code: string;
  label: string;
  hint: string;
}

export const SAMPLE_LINE = "Sample output. Add an API key to write real scripts.";

const STATUS_LABELS: Record<VersionSummary["status"], string> = {
  pending: "In Progress",
  in_review: "In Review",
  accepted: "Accepted",
  rejected: "Changes Requested",
  superseded: "Replaced",
  failed: "Failed",
};

const SOURCE_LABELS: Record<VersionSummary["source"], string> = {
  generated: "Written from your description",
  uploaded: "Uploaded",
  revised: "Revised",
  edited: "Edited by you",
};

export const statusLabel = (status: VersionSummary["status"]) => STATUS_LABELS[status];
export const sourceLabel = (source: VersionSummary["source"]) => SOURCE_LABELS[source];

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** A date in the reader's time zone (the server render may differ, so hydration is tolerant). */
export function When({ date }: { date: Date }) {
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {dateFormat.format(date)}
    </time>
  );
}

/** The script's title, logline and status, set as a title page. */
export function TitleBlock({
  version,
  fallbackTitle,
  sample,
  status,
}: {
  version: VersionView;
  fallbackTitle: string;
  sample: boolean;
  status?: ReactNode;
}) {
  return (
    <header className="flex max-w-(--measure) flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <h2 id="script-title" className="text-large-title text-balance">
          {version.title ?? fallbackTitle}
        </h2>
        {version.logline ? (
          <p className="text-reading text-pretty text-label-2">{version.logline}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-callout text-label-2">
        {status}
        <span>
          Version {version.versionNumber} · {sourceLabel(version.source)}
        </span>
      </div>
      {sample || version.isSample ? (
        <p className="text-callout text-label-2">{SAMPLE_LINE}</p>
      ) : null}
    </header>
  );
}

/** A quiet inspector section: a headline, then its content. */
export function InspectorSection({
  title,
  accessory,
  children,
}: {
  title: string;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 pt-5 hairline-t first:pt-0 first:shadow-none">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-headline">{title}</h3>
        {accessory}
      </div>
      {children}
    </section>
  );
}

/** Lets the reader open an older version read-only, and come back to the latest. */
export function useVersionViewer(projectId: string, latestId: string) {
  const [viewing, setViewing] = useState<VersionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function open(versionId: string) {
    setError(null);
    if (versionId === latestId) {
      setViewing(null);
      return;
    }
    setLoadingId(versionId);
    startTransition(async () => {
      const result = await loadVersionAction(projectId, versionId);
      setLoadingId(null);
      if (result.ok) setViewing(result.data);
      else setError(result.error);
    });
  }

  return { viewing, open, back: () => setViewing(null), error, loadingId };
}

/** The version switcher: newest first; the latest is the working one, older ones read-only. */
export function VersionList({
  versions,
  selectedId,
  loadingId,
  error,
  onSelect,
}: {
  versions: VersionSummary[];
  selectedId: string;
  loadingId: string | null;
  error: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <InspectorSection title="Versions">
      <ul className="-mx-2 flex flex-col">
        {versions.map((v) => {
          const selected = v.id === selectedId;
          return (
            <li key={v.id}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(v.id)}
                className={cn(
                  "flex min-h-(--row-h) w-full items-center gap-2 rounded-control px-2 text-left text-body focus-ring",
                  "transition-colors duration-(--dur-fast) hover:bg-fill-4",
                  selected && "bg-selection hover:bg-selection",
                )}
              >
                <span className="flex size-(--icon) shrink-0 items-center justify-center">
                  {selected ? <Check aria-hidden="true" className="size-(--icon-sm)" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">Version {v.versionNumber}</span>
                  <span className="block text-callout text-label-2">
                    {statusLabel(v.status)} · <When date={v.createdAt} />
                  </span>
                </span>
                {loadingId === v.id ? (
                  <span className="text-callout text-label-2">Opening…</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-callout text-red">
          {error}
        </p>
      ) : null}
    </InspectorSection>
  );
}

/** Bar above an older version: says it is read-only and leads back to the latest. */
export function ReadOnlyBar({ version, onBack }: { version: VersionView; onBack: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-group bg-elevated px-4 py-3">
      <p className="text-body text-label">
        Version {version.versionNumber} · {statusLabel(version.status)}.{" "}
        <span className="text-label-2">Older versions are read-only.</span>
      </p>
      <button
        type="button"
        onClick={onBack}
        className="text-body font-medium text-label underline-offset-4 focus-ring hover:underline"
      >
        Back to Latest
      </button>
    </div>
  );
}
