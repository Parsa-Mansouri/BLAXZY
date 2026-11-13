"use client";

import { useState, useTransition } from "react";
import { loadVersionAction } from "../actions";
import type { VersionView } from "./version-types";

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
