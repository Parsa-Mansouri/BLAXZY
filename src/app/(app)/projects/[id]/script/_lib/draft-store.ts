export interface DraftComment {
  id: string;
  quote: string;
  start: number;
  end: number;
  note: string;
}

/** What the store needs of `window.localStorage` (so tests can pass a fake, or null for none). */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const STORAGE_PREFIX = "blaxzy:script-comments:";

export function readStored(storage: DraftStorage | null, versionId: string): DraftComment[] {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + versionId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is DraftComment =>
        typeof c === "object" &&
        c !== null &&
        typeof c.id === "string" &&
        typeof c.quote === "string" &&
        typeof c.note === "string" &&
        typeof c.start === "number" &&
        typeof c.end === "number" &&
        c.note.trim() !== "",
    );
  } catch {
    return [];
  }
}

function writeStored(
  storage: DraftStorage | null,
  versionId: string,
  comments: readonly DraftComment[],
) {
  try {
    const kept = comments.filter((c) => c.note.trim() !== "");
    if (kept.length === 0) storage?.removeItem(STORAGE_PREFIX + versionId);
    else storage?.setItem(STORAGE_PREFIX + versionId, JSON.stringify(kept));
  } catch {
    // Storage may be unavailable (private window); comments still work for this visit.
  }
}

/** Only comments whose passage is still where it was (the text is the same version's). */
export const stillThere = (content: string) => (c: DraftComment) =>
  content.slice(c.start, c.end) === c.quote;

/**
 * The drafts of each version: read from storage the first time a version is asked for, written
 * back on every change. Each version has its own list, so a change of version never carries
 * comments over. Small external store for `useSyncExternalStore`: `get` returns the same array
 * until the version's drafts change.
 */
export function createDraftStore(storage: DraftStorage | null) {
  const drafts = new Map<string, DraftComment[]>();
  const listeners = new Set<() => void>();
  return {
    get(versionId: string): DraftComment[] {
      let list = drafts.get(versionId);
      if (!list) {
        list = readStored(storage, versionId);
        drafts.set(versionId, list);
      }
      return list;
    },
    set(versionId: string, next: DraftComment[]) {
      drafts.set(versionId, next);
      writeStored(storage, versionId, next);
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
