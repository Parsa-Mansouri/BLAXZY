"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, Textarea } from "@/ui";
import type { PassagePick } from "./script-document";

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

/**
 * The review's pending comments. Kept in this browser until they are sent, so a reload does not
 * lose them.
 */
export function useDraftComments(versionId: string, content: string) {
  const [comments, setComments] = useState<DraftComment[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    // Only comments whose passage is still where it was (the text is the same version's).
    const stored = readStored(versionId).filter((c) => content.slice(c.start, c.end) === c.quote);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is read after hydration
    setComments(stored);
    loaded.current = true;
  }, [versionId, content]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      if (comments.length === 0) window.localStorage.removeItem(STORAGE_PREFIX + versionId);
      else window.localStorage.setItem(STORAGE_PREFIX + versionId, JSON.stringify(comments));
    } catch {
      // Storage may be unavailable (private window); comments still work for this visit.
    }
  }, [comments, versionId]);

  return {
    comments,
    add: (pick: PassagePick, note: string) => {
      const comment: DraftComment = {
        id: crypto.randomUUID(),
        quote: pick.quote,
        start: pick.start,
        end: pick.end,
        note,
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

/** A comment's note: Cancel and Add or Save, Escape cancels, Cmd/Ctrl+Enter confirms. */
export function CommentEditor({
  initial = "",
  confirmLabel,
  onConfirm,
  onCancel,
  autoFocus = true,
}: {
  initial?: string;
  confirmLabel: string;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}) {
  const [note, setNote] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    const value = note.trim();
    if (!value) {
      setError("Write what should change, or cancel.");
      return;
    }
    if (value.length > MAX_COMMENT_CHARS) {
      setError("Keep the comment under 4,000 characters.");
      return;
    }
    onConfirm(value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      confirm();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Comment"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
        placeholder="What should change here?"
        minRows={2}
        maxRows={8}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <p role="alert" className="text-callout text-red">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="plain" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={confirm}>{confirmLabel}</Button>
      </div>
    </div>
  );
}

/** The floating composer under the chosen passage. */
export function CommentComposer({
  pick,
  onAdd,
  onCancel,
}: {
  pick: PassagePick;
  onAdd: (note: string) => void;
  onCancel: () => void;
}) {
  const tooLong = pick.quote.length > MAX_QUOTE_CHARS;
  return (
    <div
      role="dialog"
      aria-label="Add Comment"
      className="absolute inset-x-0 z-20 flex justify-start"
      style={{ top: pick.top + 8 }}
    >
      <div
        className="flex w-full max-w-[24rem] popup-motion flex-col gap-3 rounded-popover bg-elevated-2 p-3 shadow-float"
        style={{ marginLeft: `clamp(0px, ${pick.left}px, calc(100% - 24rem))` }}
      >
        <p className="line-clamp-2 text-callout text-label-2">“{pick.quote}”</p>
        {tooLong ? (
          <>
            <p role="alert" className="text-callout text-red">
              This passage is too long for one comment. Select up to 5,000 characters.
            </p>
            <div className="flex justify-end">
              <Button onClick={onCancel}>Close</Button>
            </div>
          </>
        ) : (
          <CommentEditor confirmLabel="Add Comment" onConfirm={onAdd} onCancel={onCancel} />
        )}
      </div>
    </div>
  );
}
