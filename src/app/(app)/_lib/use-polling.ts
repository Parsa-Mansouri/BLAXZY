"use client";

import { useEffect, useRef, useState } from "react";

/** Poll gap while something is being made. */
export const FAST_POLL_MS = 2000;
/** Poll gap when nothing is moving but the screen still listens for news. */
export const SETTLED_POLL_MS = 10000;
/** The longest a run of failures can push the gap. */
export const MAX_BACKOFF_MS = 60_000;
/** A focus or visibility event within this long of the last poll does not poll again. */
export const MIN_WAKE_GAP_MS = 1000;

/**
 * How long to wait before the next poll: the interval after a success, doubling with each
 * consecutive failure up to `MAX_BACKOFF_MS`, with up to 25% jitter either way so many tabs do
 * not retry in step. `random` is injectable (0 to 1).
 */
export function nextDelay({
  intervalMs,
  failures,
  random = Math.random,
}: {
  intervalMs: number;
  failures: number;
  random?: () => number;
}): number {
  if (failures <= 0) return intervalMs;
  const base = Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** Math.min(failures, 16));
  const jitter = 0.75 + random() * 0.5;
  return Math.min(MAX_BACKOFF_MS, Math.round(base * jitter));
}

/** Whether a focus or visibility event should poll now rather than wait for the timer. */
export function shouldWakePoll({
  now,
  lastStartedAt,
  minGapMs = MIN_WAKE_GAP_MS,
}: {
  now: number;
  lastStartedAt: number | null;
  minGapMs?: number;
}): boolean {
  return lastStartedAt === null || now - lastStartedAt >= minGapMs;
}

/**
 * The abort handle of the poll in flight: `begin()` starts a poll's signal (and aborts a previous
 * one that is somehow still running), `abort()` aborts the current one. Pure, so it is tested
 * without React.
 */
export function createAbortSlot() {
  let controller: AbortController | null = null;
  return {
    begin(): AbortSignal {
      controller?.abort();
      controller = new AbortController();
      return controller.signal;
    },
    abort() {
      controller?.abort();
      controller = null;
    },
  };
}

/**
 * Calls `poll` every `intervalMs` while `enabled`, one call at a time (also across a change of
 * interval). Pauses while the tab is hidden and polls again when it becomes visible or focused,
 * at most once per `MIN_WAKE_GAP_MS`. A poll that throws backs the next one off exponentially
 * (with jitter, capped); a success resets it. With `immediate` the first call is made at once
 * instead of after the first interval.
 *
 * `poll` receives `isActive`, which turns false once the poller is disabled or its component has
 * unmounted. A poll that was in flight when the user navigated away must check it before calling
 * `router.refresh()`: refreshing the page that is being navigated to races its navigation.
 *
 * It also receives an `AbortSignal`, aborted when the component unmounts or `enabled` turns
 * false (not on a change of interval: that poll is let finish). Pass it to the poll client so the
 * request is cancelled; a cancelled poll answers the quiet value.
 */
export function usePolling(
  poll: (isActive: () => boolean, signal: AbortSignal) => Promise<void>,
  enabled: boolean,
  intervalMs = FAST_POLL_MS,
  immediate = false,
) {
  const latest = useRef(poll);
  const inFlight = useRef(false);
  const failures = useRef(0);
  const lastStartedAt = useRef<number | null>(null);
  const mounted = useRef(true);
  const enabledRef = useRef(enabled);
  const [slot] = useState(createAbortSlot);

  useEffect(() => {
    latest.current = poll;
  });
  useEffect(() => {
    enabledRef.current = enabled;
    // Switched off: the poll in flight has nothing left to say.
    if (!enabled) slot.abort();
  }, [enabled, slot]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      slot.abort();
    };
  }, [slot]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const isActive = () => mounted.current && enabledRef.current;

    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState === "hidden") return;
      timer = setTimeout(tick, nextDelay({ intervalMs, failures: failures.current }));
    };

    async function tick() {
      if (stopped || document.visibilityState === "hidden") return;
      if (inFlight.current) {
        // The poll started under the previous interval is still running; look again later.
        schedule();
        return;
      }
      inFlight.current = true;
      lastStartedAt.current = Date.now();
      try {
        await latest.current(isActive, slot.begin());
        failures.current = 0;
      } catch {
        failures.current += 1;
      } finally {
        inFlight.current = false;
        schedule();
      }
    }

    const wake = () => {
      if (document.visibilityState !== "visible") {
        clearTimeout(timer);
        return;
      }
      if (shouldWakePoll({ now: Date.now(), lastStartedAt: lastStartedAt.current })) {
        clearTimeout(timer);
        void tick();
      } else if (!inFlight.current) {
        schedule();
      }
    };

    if (immediate) void tick();
    else schedule();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [enabled, intervalMs, immediate, slot]);
}
