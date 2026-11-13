"use client";

import { Tabs } from "@/ui";
import type { VersionSummary } from "./version-types";
import type { VersionViewer } from "./use-version-viewer";

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
