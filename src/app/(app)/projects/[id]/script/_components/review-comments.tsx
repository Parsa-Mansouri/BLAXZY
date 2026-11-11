"use client";

import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/ui";

export interface DraftComment {
  id: string;
  quote: string;
  start: number;
  end: number;
  note: string;
}

const STORAGE_PREFIX = "blaxzy:script-comments:";
export const MAX_COMMENT_CHARS = 4000;
export const MAX_QUOTE_CHARS = 5000;

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
 * The review's pending comments. Kept in this browser until they are sent, so a reload does not
 * lose them.
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
    /** A new, empty comment on the passage; it is dropped again if left empty. */
    add: (range: { start: number; end: number; quote: string }) => {
      const comment: DraftComment = {
        id: crypto.randomUUID(),
        quote: range.quote.slice(0, MAX_QUOTE_CHARS),
        start: range.start,
        end: Math.min(range.end, range.start + MAX_QUOTE_CHARS),
        note: "",
      };
      setComments((list) => [...list, comment].sort((a, b) => a.start - b.start));
      return comment;
    },
    update: (id: string, note: string) =>
      setComments((list) => list.map((c) => (c.id === id ? { ...c, note } : c))),
    remove: (id: string) => setComments((list) => list.filter((c) => c.id !== id)),
    clear: () => setComments([]),
  };
}

/**
 * A comment beside its line: the note is edited in place (it is kept as you type), Remove takes
 * it away, and leaving it empty removes it.
 */
export function LineComment({
  comment,
  autoFocus,
  describedBy,
  onChange,
  onRemove,
}: {
  comment: DraftComment;
  autoFocus?: boolean;
  /** id of the line the comment is about. */
  describedBy?: string;
  onChange: (note: string) => void;
  onRemove: () => void;
}) {
  const tooLong = comment.note.trim().length > MAX_COMMENT_CHARS;
  return (
    <div
      className="flex swap-in flex-col items-end gap-1.5"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (comment.note.trim() === "") onRemove();
      }}
    >
      <Textarea
        className="w-full"
        aria-label="Your comment on this line"
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
        autoFocus={autoFocus}
      />
      {tooLong ? (
        <p role="alert" className="self-start text-meta text-red">
          Keep the comment under 4,000 characters.
        </p>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        className="press rounded-row text-meta text-label-2 underline underline-offset-[3px] focus-ring hover:text-label"
      >
        Remove
      </button>
    </div>
  );
}
