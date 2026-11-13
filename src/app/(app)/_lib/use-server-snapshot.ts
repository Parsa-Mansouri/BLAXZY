"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * Merges a fresh first page from the server into a list that may have had further pages loaded
 * ("Load more"). Items the fresh page covers are replaced by the fresh ones (matched by id); the
 * items loaded beyond what it covers are kept, in order, together with their cursor. When nothing
 * in the fresh page overlaps the current list (it is a different list), or the current list is
 * empty, the fresh page wins outright.
 */
export function mergeLoadedPages<T>({
  current,
  currentCursor,
  fresh,
  freshCursor,
  id,
}: {
  current: readonly T[];
  currentCursor: string | null;
  fresh: readonly T[];
  freshCursor: string | null;
  id: (item: T) => string;
}): { items: T[]; cursor: string | null } {
  const freshIds = new Set(fresh.map(id));
  let lastCovered = -1;
  current.forEach((item, index) => {
    if (freshIds.has(id(item))) lastCovered = index;
  });
  if (lastCovered === -1) return { items: [...fresh], cursor: freshCursor };
  const tail = current.slice(lastCovered + 1).filter((item) => !freshIds.has(id(item)));
  if (tail.length === 0) return { items: [...fresh], cursor: freshCursor };
  return { items: [...fresh, ...tail], cursor: currentCursor };
}

/**
 * Local copy of server-rendered data that follows it: when the server prop changes (a
 * `router.refresh()`, coming back to the screen) `merge(current, initial)` decides what the local
 * state becomes, so pages loaded with "Load more" survive instead of snapping back to page one.
 * Pass `(_, fresh) => fresh` for data without pages. Returns the state and its setter, like
 * `useState`.
 */
export function useServerSnapshot<S>(
  initial: S,
  merge: (current: S, fresh: S) => S,
): [S, Dispatch<SetStateAction<S>>] {
  const [state, setState] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setState((current) => merge(current, initial));
  }
  return [state, setState];
}
