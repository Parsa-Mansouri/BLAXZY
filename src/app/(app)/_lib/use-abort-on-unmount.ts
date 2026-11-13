"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a function that gives the current `AbortSignal`; the signal aborts when the component
 * unmounts. Pass it to uploads so nothing keeps running, or updates state, after the screen is
 * gone. Strict Mode's simulated unmount aborts the signal too, so the effect makes a fresh one on
 * the remount (declare this hook before effects that start work).
 */
export function useAbortOnUnmount(): () => AbortSignal {
  const controller = useRef<AbortController | null>(null);
  const current = useCallback(() => {
    controller.current ??= new AbortController();
    return controller.current.signal;
  }, []);
  useEffect(() => {
    if (controller.current?.signal.aborted) controller.current = null;
    return () => controller.current?.abort();
  }, []);
  return current;
}
