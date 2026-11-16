"use client";

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { Button, Textarea } from "@/ui";
import {
  createDraftStore,
  stillThere,
  type DraftComment,
  type DraftStorage,
} from "../_lib/draft-store";

export type { DraftComment };

export const MAX_COMMENT_CHARS = 4000;
/** The server takes quotes of at most 5,000 characters. */
export const MAX_QUOTE_CHARS = 5000;
/** The server takes at most 100 comments in one review. */
export const MAX_REVIEW_COMMENTS = 100;

/** Browser storage, or null where it is not available (private windows, server render). */
function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const store = createDraftStore(browserStorage());
const NO_DRAFTS: DraftComment[] = [];

/** A comment the reviser can use: it says something and fits the limits. */
export const isSendable = (c: DraftComment) =>
  c.note.trim().length > 0 && c.note.trim().length <= MAX_COMMENT_CHARS;

/**
 * The review's pending comments, each on any passage of the script (`start`/`end` are offsets
 * into the version's text, `quote` its exact characters). Kept in this browser until they are
 * sent, so a reload does not lose them.
 */
export function useDraftComments(versionId: string, content: string) {
  const stored = useSyncExternalStore(
    store.subscribe,
    () => store.get(versionId),
    () => NO_DRAFTS,
  );
  const comments = useMemo(() => stored.filter(stillThere(content)), [stored, content]);
  /** The current list at call time, so two changes in one event both land. */
  const current = () => store.get(versionId).filter(stillThere(content));
  const change = (next: DraftComment[]) => store.set(versionId, next);

  return {
    comments,
    /** Room for another comment (the server takes at most 100). */
    full: comments.length >= MAX_REVIEW_COMMENTS,
    /**
     * A new, empty comment on the passage; it is dropped again if left empty. The caller keeps
     * the passage within MAX_QUOTE_CHARS (it tells the reader to select less).
     */
    add: (range: { start: number; end: number; quote: string }) => {
      const comment: DraftComment = {
        id: crypto.randomUUID(),
        quote: range.quote,
        start: range.start,
        end: range.end,
        note: "",
      };
      change([...current(), comment].sort((a, b) => a.start - b.start || a.end - b.end));
      return comment;
    },
    update: (id: string, note: string) =>
      change(current().map((c) => (c.id === id ? { ...c, note } : c))),
    remove: (id: string) => change(current().filter((c) => c.id !== id)),
    clear: () => change([]),
  };
}

/**
 * A comment beside its passage: the note is edited in place (it is kept as you type), Remove
 * (or Escape on an empty note) takes it away, and leaving it empty discards it.
 */
export function LineComment({
  comment,
  fieldId,
  describedBy,
  onChange,
  onRemove,
  onDiscard,
  menu,
}: {
  comment: DraftComment;
  /** id of the textarea, so the sheet can focus a new comment. */
  fieldId?: string;
  /** id of an element naming the passage the comment is about. */
  describedBy?: string;
  onChange: (note: string) => void;
  /** Removed on purpose (Remove, Escape): the sheet moves focus somewhere sensible. */
  onRemove: () => void;
  /** Left empty when focus moved elsewhere: removed without moving focus. */
  onDiscard?: () => void;
  /** The "…" menu button, shown beside Remove. */
  menu?: ReactNode;
}) {
  const tooLong = comment.note.trim().length > MAX_COMMENT_CHARS;
  return (
    <div
      className="flex swap-in flex-col items-end gap-1.5"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (comment.note.trim() === "") (onDiscard ?? onRemove)();
      }}
    >
      <Textarea
        className="w-full"
        id={fieldId}
        aria-label="Your comment on this passage"
        aria-describedby={describedBy}
        aria-invalid={tooLong ? true : undefined}
        value={comment.note}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && comment.note.trim() === "") {
            e.preventDefault();
            onRemove();
          }
        }}
        placeholder="What should change?"
        minRows={2}
        maxRows={8}
      />
      {tooLong ? (
        <p role="alert" className="self-start text-meta text-red">
          Keep the comment under 4,000 characters.
        </p>
      ) : null}
      <div className="flex items-center gap-1">
        <Button variant="plain" size="small" onClick={onRemove}>
          Remove
        </Button>
        {menu}
      </div>
    </div>
  );
}
