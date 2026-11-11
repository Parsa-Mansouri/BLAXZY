"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Keeps the sidebar's credit balance current without a navigation. The balance changes when a
 * generation is reserved or settles (a refund), not at the click, so:
 * - a screen where credits can be spent calls `useCreditWatch()` while it is mounted, and the
 *   sidebar polls the balance while any such screen is open;
 * - an action that may have spent calls `refreshCredits()`, and the sidebar reads it at once (and
 *   once more shortly after, for the job that reserves it).
 * Browser-only state of this tab; nothing is shared between requests on the server.
 */
interface CreditsSnapshot {
  /** How many mounted screens can spend credits. */
  watchers: number;
  /** Bumped by `refreshCredits`. */
  requests: number;
}

let snapshot: CreditsSnapshot = { watchers: 0, requests: 0 };
const listeners = new Set<() => void>();

function update(next: Partial<CreditsSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER_SNAPSHOT: CreditsSnapshot = { watchers: 0, requests: 0 };

/** Asks the sidebar to read the balance again now. */
export function refreshCredits(): void {
  update({ requests: snapshot.requests + 1 });
}

/** Marks a screen where credits can be spent: the balance is polled while it is mounted. */
export function useCreditWatch(active = true): void {
  useEffect(() => {
    if (!active) return;
    update({ watchers: snapshot.watchers + 1 });
    return () => update({ watchers: Math.max(0, snapshot.watchers - 1) });
  }, [active]);
}

/** For the sidebar: whether to poll, and a counter that changes when a refresh is asked for. */
export function useCreditsState(): CreditsSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
}
