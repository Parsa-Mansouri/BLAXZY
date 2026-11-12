"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Textarea } from "@/ui";

export interface DraftComment {
  id: string;
  quote: string;
  start: number;
  end: number;
  note: string;
}

const STORAGE_PREFIX = "blaxzy:script-comments:";
export const MAX_COMMENT_CHARS = 4000;
/** The server takes quotes of at most 5,000 characters. */
export const MAX_QUOTE_CHARS = 5000;
/** The server takes at most 100 comments in one review. */
export const MAX_REVIEW_COMMENTS = 100;

function readStored(versionId: string): DraftComment[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + versionId);
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
        typeof c.end === "number",
    );
  } catch {
    return [];
  }
}

/** A comment the reviser can use: it says something and fits the limits. */
export const isSendable = (c: DraftComment) =>
  c.note.trim().length > 0 && c.note.trim().length <= MAX_COMMENT_CHARS;

/**
 * The review's pending comments, each on any passage of the script (`start`/`end` are offsets
 * into the version's text, `quote` its exact characters). Kept in this browser until they are
 * sent, so a reload does not lose them.
 */
export function useDraftComments(versionId: string, content: string) {
  const [comments, setComments] = useState<DraftComment[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    // Only comments whose passage is still where it was (the text is the same version's).
    const stored = readStored(versionId).filter(
      (c) => content.slice(c.start, c.end) === c.quote && c.note.trim() !== "",
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is read after hydration
    setComments(stored);
    loaded.current = true;
  }, [versionId, content]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      const kept = comments.filter((c) => c.note.trim() !== "");
      if (kept.length === 0) window.localStorage.removeItem(STORAGE_PREFIX + versionId);
      else window.localStorage.setItem(STORAGE_PREFIX + versionId, JSON.stringify(kept));
    } catch {
      // Storage may be unavailable (private window); comments still work for this visit.
    }
  }, [comments, versionId]);

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
      setComments((list) => [...list, comment].sort((a, b) => a.start - b.start || a.end - b.end));
      return comment;
    },
    update: (id: string, note: string) =>
      setComments((list) => list.map((c) => (c.id === id ? { ...c, note } : c))),
    remove: (id: string) => setComments((list) => list.filter((c) => c.id !== id)),
    clear: () => setComments([]),
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
      <Button variant="plain" size="small" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}
