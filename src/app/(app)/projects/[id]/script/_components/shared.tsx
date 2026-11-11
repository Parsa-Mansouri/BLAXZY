"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { ScriptVersionSummary, ScriptVersionView } from "@/server/script";
import { SelectRow, StatusLine, Tabs, stagger } from "@/ui";
import type { Scene } from "../_lib/scenes";
import { loadVersionAction } from "../actions";

export type VersionView = ScriptVersionView;
export type VersionSummary = ScriptVersionSummary;
export type Finding = NonNullable<VersionView["findings"]>[number];

export interface IssueChoice {
  code: string;
  label: string;
  hint: string;
}

export const SAMPLE_LINE = "Sample output. Add an API key to write real scripts.";

const STATUS_LABELS: Record<VersionSummary["status"], string> = {
  pending: "In progress",
  in_review: "In review",
  accepted: "Accepted",
  rejected: "Changes requested",
  superseded: "Replaced",
  failed: "Failed",
};

export const statusLabel = (status: VersionSummary["status"]) => STATUS_LABELS[status];

const SEVERITY: Record<Finding["severity"], string> = {
  blocker: "Must fix",
  major: "Important",
  minor: "Minor",
};

/** Lets the reader open an older version read-only, and come back to the latest. */
export function useVersionViewer(projectId: string, latestId: string) {
  const [viewing, setViewing] = useState<VersionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function open(versionId: string) {
    setError(null);
    if (versionId === latestId) {
      setLoadingId(null);
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

export type VersionViewer = ReturnType<typeof useVersionViewer>;

/** The version tab strip (newest first, one sliding underline). Nothing when there is one. */
export function VersionTabs({
  versions,
  shownId,
  viewer,
  onOpen,
}: {
  versions: VersionSummary[];
  shownId: string;
  viewer: VersionViewer;
  onOpen?: (id: string) => void;
}) {
  if (versions.length <= 1) return null;
  const latest = versions[0];
  return (
    <div className="mb-8 in-2">
      <Tabs
        aria-label="Versions"
        value={viewer.loadingId ?? shownId}
        onValueChange={(id) => {
          onOpen?.(id);
          viewer.open(id);
        }}
        tabs={versions.map((v) => ({ value: v.id, label: `Version ${v.versionNumber}` }))}
        trailing={
          viewer.loadingId
            ? "Opening…"
            : latest && shownId !== latest.id
              ? "Earlier version, read only"
              : undefined
        }
      />
      {viewer.error ? (
        <p role="alert" className="mt-3 text-secondary text-red">
          {viewer.error}
        </p>
      ) : null}
    </div>
  );
}

/** Name of a scene in the list: its heading, or "Opening" for the text before the first one. */
export const sceneName = (scene: Scene) => scene.heading ?? "Opening";

/** The scene list on the left; it chooses which scene the sheet shows. */
export function SceneList({
  scenes,
  index,
  onSelect,
  counts,
}: {
  scenes: Scene[];
  index: number;
  onSelect: (index: number) => void;
  /** Comments and script checks on each scene, shown at the row's end. */
  counts?: number[];
}) {
  return (
    <nav aria-label="Scenes" className="flex flex-col gap-0.5">
      {scenes.map((scene, i) => {
        const count = counts?.[i] ?? 0;
        return (
          <SelectRow
            key={scene.key}
            size="regular"
            label={sceneName(scene)}
            active={i === index}
            onClick={() => onSelect(i)}
            trailing={
              count > 0 ? (
                <>
                  <span aria-hidden="true">{count}</span>
                  <span className="sr-only">
                    , {count} {count === 1 ? "note" : "notes"}
                  </span>
                </>
              ) : undefined
            }
            className="enter"
            style={stagger(i)}
          />
        );
      })}
    </nav>
  );
}

/**
 * Scenes left, sheet right. The list is slim so the screenplay gets a comfortable width; below
 * about 760px of content the sheet wraps under the list.
 */
export function ScenesLayout({ side, children }: { side: ReactNode; children: ReactNode }) {
  return (
    <div className="flex in-3 flex-wrap items-start gap-x-6 gap-y-8">
      {side ? (
        <div className="flex min-w-0 flex-[1_1_176px] flex-col gap-6 sm:max-w-44">{side}</div>
      ) : null}
      <div className="min-w-0 flex-[4_1_560px]">{children}</div>
    </div>
  );
}

/** A script check finding: a status line, what is wrong, and what to do. */
export function FindingNote({ finding }: { finding: Finding }) {
  return (
    <div className="flex flex-col gap-1">
      <StatusLine tone="waiting">Script check · {SEVERITY[finding.severity]}</StatusLine>
      <p className="text-secondary text-label">{finding.explanation}</p>
      {finding.suggestion ? (
        <p className="text-secondary text-label-2">{finding.suggestion}</p>
      ) : null}
    </div>
  );
}

/**
 * The notes that came with a version (titled by where it came from), and any script check that
 * is about the whole script rather than one line.
 */
export function VersionNotes({
  version,
  looseFindings = [],
}: {
  version: VersionView;
  looseFindings?: Finding[];
}) {
  if (version.notes.length === 0 && looseFindings.length === 0) return null;
  const title =
    version.source === "revised"
      ? "What Changed"
      : version.source === "uploaded"
        ? "Script Check"
        : "Writer’s Notes";
  return (
    <section
      aria-labelledby="version-notes"
      className="mt-12 flex max-w-170 flex-col gap-4 pt-6 hairline-t"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="version-notes" className="text-section">
          {title}
        </h2>
        {version.checkVerdict === "ready" ? (
          <StatusLine tone="done">Ready to film</StatusLine>
        ) : version.checkVerdict === "needs_attention" ? (
          <StatusLine tone="waiting">Needs attention</StatusLine>
        ) : null}
      </div>
      {version.notes.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {version.notes.map((note, i) => (
            <li key={i} className="text-body text-pretty text-label-2">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      {looseFindings.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {looseFindings.map((finding, i) => (
            <li key={i}>
              <FindingNote finding={finding} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
