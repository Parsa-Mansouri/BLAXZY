/**
 * Storage helper behind `useDismissed`. Pure and injectable so it can be tested
 * without a browser. Every storage call is guarded: private windows, blocked site
 * data and quota errors must never break the page.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DISMISSED_PREFIX = "blaxzy:dismissed:";

export function dismissedStorageKey(key: string): string {
  return `${DISMISSED_PREFIX}${key}`;
}

export function readDismissed(storage: KeyValueStorage | null, key: string): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(dismissedStorageKey(key)) === "1";
  } catch {
    return false;
  }
}

/** Returns true when the write stuck. */
export function writeDismissed(
  storage: KeyValueStorage | null,
  key: string,
  dismissed: boolean,
): boolean {
  if (!storage) return false;
  try {
    if (dismissed) storage.setItem(dismissedStorageKey(key), "1");
    else storage.removeItem(dismissedStorageKey(key));
    return true;
  } catch {
    return false;
  }
}

/** The browser's localStorage, or null on the server or when access throws. */
export function getBrowserStorage(): KeyValueStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
