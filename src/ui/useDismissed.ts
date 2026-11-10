"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getBrowserStorage, readDismissed, writeDismissed } from "./dismissed-store";

const listeners = new Set<() => void>();
/** Fallback when storage is unavailable, so a dismissal still lasts for the session. */
const memory = new Set<string>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = () => callback();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

export interface UseDismissed {
  /** True once dismissed. Also true during SSR and the first paint, so hints never flash. */
  dismissed: boolean;
  dismiss: () => void;
  reset: () => void;
}

/** Remembers that the user closed a hint or coach mark. SSR-safe; storage errors are swallowed. */
export function useDismissed(key: string): UseDismissed {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => memory.has(key) || readDismissed(getBrowserStorage(), key),
    () => true,
  );

  const dismiss = useCallback(() => {
    memory.add(key);
    writeDismissed(getBrowserStorage(), key, true);
    emit();
  }, [key]);

  const reset = useCallback(() => {
    memory.delete(key);
    writeDismissed(getBrowserStorage(), key, false);
    emit();
  }, [key]);

  return { dismissed, dismiss, reset };
}
