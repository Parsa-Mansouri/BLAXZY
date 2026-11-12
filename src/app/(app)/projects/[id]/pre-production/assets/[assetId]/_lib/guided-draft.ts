"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Answers to the guided questions, kept in the browser until they are submitted. */
export interface GuidedDraft {
  answers: Record<string, string>;
  /** The question on screen (older drafts may hold the question count: the last question). */
  step: number;
}

const PREFIX = "blaxzy:guided:";
const CHANGE = "blaxzy:guided-change";

/** Reads a stored draft; anything unreadable counts as none. */
export function parseDraft(raw: string | null): GuidedDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { answers, step } = value as { answers?: unknown; step?: unknown };
    if (typeof answers !== "object" || answers === null || typeof step !== "number") return null;
    const clean: Record<string, string> = {};
    for (const [key, answer] of Object.entries(answers)) {
      if (typeof answer === "string") clean[key] = answer;
    }
    return { answers: clean, step: Math.max(0, Math.floor(step)) };
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE, onChange);
  };
}

/**
 * The asset's saved draft (null on the server and until the browser is read), with `save` and
 * `clear`. The raw string is the snapshot, so the parsed value only changes when the text does.
 */
export function useGuidedDraft(assetId: string) {
  const key = PREFIX + assetId;
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const draft = parsedDraft(raw);

  const save = useCallback(
    (next: GuidedDraft) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private windows may refuse storage; the answers then last for this visit only.
      }
      window.dispatchEvent(new Event(CHANGE));
    },
    [key],
  );

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing stored.
    }
    window.dispatchEvent(new Event(CHANGE));
  }, [key]);

  return { draft, save, clear };
}

const cache = new Map<string, GuidedDraft | null>();

function parsedDraft(raw: string | null): GuidedDraft | null {
  if (raw === null) return null;
  if (!cache.has(raw)) {
    if (cache.size > 20) cache.clear();
    cache.set(raw, parseDraft(raw));
  }
  return cache.get(raw) ?? null;
}
