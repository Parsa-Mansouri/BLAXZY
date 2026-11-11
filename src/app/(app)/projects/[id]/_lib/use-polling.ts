"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `poll` every `intervalMs` while `enabled`, one call at a time. Pauses while the tab is
 * hidden and polls at once when it becomes visible or focused again.
 *
 * `poll` receives `isActive`, which turns false once the poller is disabled or its component has
 * unmounted. A poll that was in flight when the user navigated away must check it before calling
 * `router.refresh()`: refreshing the page that is being navigated to races its navigation.
 */
export function usePolling(
  poll: (isActive: () => boolean) => Promise<void>,
  enabled: boolean,
  intervalMs = 2000,
) {
  const latest = useRef(poll);
  useEffect(() => {
    latest.current = poll;
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let stopped = false;

    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState === "hidden") return;
      timer = setTimeout(tick, intervalMs);
    };

    async function tick() {
      if (running || stopped || document.visibilityState === "hidden") return;
      running = true;
      try {
        await latest.current(() => !stopped);
      } catch {
        // A failed poll (offline, server restart) is retried on the next tick.
      } finally {
        running = false;
        schedule();
      }
    }

    const wake = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void tick();
      } else {
        clearTimeout(timer);
      }
    };

    schedule();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [enabled, intervalMs]);
}
