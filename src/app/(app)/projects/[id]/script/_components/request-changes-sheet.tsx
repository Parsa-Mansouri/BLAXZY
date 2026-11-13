"use client";

import { useState } from "react";
import {
  WRITER_REASON_VIEWS,
  type WriterReasonCode,
  type WriterReasonView,
} from "@/lib/script-reasons";
import { Button, Field, Sheet, Textarea, cn } from "@/ui";
import { Fader, type FaderStop } from "./fader";

const MAX_NOTE_CHARS = 8000;

type FaderKey = "length" | "genre" | "style" | "depth";

/**
 * The four nudges, each a pair of the writer's reason codes: stop labels (-1, 0, +1) and the
 * code each non-zero stop sends.
 */
const FADERS: readonly {
  key: FaderKey;
  name: string;
  labels: readonly [string, string, string];
  codes: { [-1]: WriterReasonCode; 1: WriterReasonCode };
}[] = [
  {
    key: "length",
    name: "Length",
    labels: ["Shorter", "As is", "Longer"],
    codes: { [-1]: "too_long", 1: "too_short" },
  },
  {
    key: "genre",
    name: "Genre",
    labels: ["Lighter", "As is", "Stronger"],
    codes: { [-1]: "less_genre_feeling", 1: "more_genre_feeling" },
  },
  {
    key: "style",
    name: "Look",
    labels: ["Plainer", "As is", "Bolder"],
    codes: { [-1]: "less_visual_style", 1: "more_visual_style" },
  },
  {
    key: "depth",
    name: "Depth",
    labels: ["Simpler", "As is", "Deeper"],
    codes: { [-1]: "simplify", 1: "add_depth" },
  },
];

const ON_FADERS = new Set<string>(FADERS.flatMap((f) => [f.codes[-1], f.codes[1]]));

/** The remaining reasons, as square tiles: things that are wrong, and things to make different. */
const TILE_GROUPS: readonly { title: string; reasons: WriterReasonView[] }[] = [
  {
    title: "Something’s Wrong",
    reasons: WRITER_REASON_VIEWS.filter((r) => r.type === "technical" && !ON_FADERS.has(r.code)),
  },
  {
    title: "Make It Different",
    reasons: WRITER_REASON_VIEWS.filter((r) => r.type === "preference" && !ON_FADERS.has(r.code)),
  },
];

function ReasonTile({
  reason,
  on,
  disabled,
  onToggle,
}: {
  reason: WriterReasonView;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      title={reason.hint}
      className={cn(
        "relative flex aspect-square flex-col items-start justify-end rounded-item border p-3 text-left text-body transition-colors motion-reduce:transition-none",
        on
          ? "border-brand bg-brand/10 text-label"
          : "border-outline-quiet bg-elevated text-label-2 hover:border-outline",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-2.5 left-2.5 flex size-4 items-center justify-center rounded-[3px] border transition-colors motion-reduce:transition-none",
          on ? "border-brand bg-brand" : "border-outline",
        )}
      >
        {on ? (
          <svg viewBox="0 0 10 10" className="size-2.5 text-ground" fill="none">
            <path d="M2 5.2 4.2 7.4 8 2.8" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        ) : null}
      </span>
      {reason.label}
    </button>
  );
}

export function RequestChangesSheet({
  open,
  onOpenChange,
  commentCount,
  sending,
  serverError,
  onSubmit,
  initialNote = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commentCount: number;
  sending: boolean;
  serverError: string | null;
  onSubmit: (input: { issueCodes: string[]; note: string }) => void;
  /** Prefilled note (rejecting one of the writer's assumptions). */
  initialNote?: string;
}) {
  const [stops, setStops] = useState<Record<FaderKey, FaderStop>>({
    length: 0,
    genre: 0,
    style: 0,
    depth: 0,
  });
  const [picked, setPicked] = useState<WriterReasonCode[]>([]);
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);

  function setStop(key: FaderKey, value: FaderStop) {
    setError(null);
    setStops((s) => ({ ...s, [key]: value }));
  }

  function toggle(code: WriterReasonCode) {
    setError(null);
    setPicked((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  }

  function submit() {
    const trimmed = note.trim();
    const codes: WriterReasonCode[] = [];
    for (const fader of FADERS) {
      const stop = stops[fader.key];
      if (stop !== 0) codes.push(fader.codes[stop]);
    }
    codes.push(...picked);
    if (codes.length === 0 && !trimmed && commentCount === 0) {
      setError(
        "Move a fader, pick something to fix, write a note, or comment on the script first.",
      );
      return;
    }
    if (trimmed.length > MAX_NOTE_CHARS) {
      setError("Keep the note under 8,000 characters.");
      return;
    }
    onSubmit({ issueCodes: codes, note: trimmed });
  }

  const shownError = error ?? serverError;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Request Changes"
      description="Tell the next version what to change. It comes back revised for another review."
      footer={
        <div className="flex w-full items-center gap-3">
          <p className="mr-auto text-secondary text-label-2 tabular-nums">
            {commentCount > 0
              ? `+ your ${commentCount} line comment${commentCount === 1 ? "" : "s"}`
              : null}
          </p>
          <Button variant="plain" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button variant="primary" loading={sending} onClick={submit}>
            Request Changes
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field
          label={<span className="font-mono text-meta tracking-caps uppercase">Your note</span>}
        >
          <Textarea
            autoFocus
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            placeholder="What should the next version do differently?"
            minRows={3}
            maxRows={8}
          />
        </Field>

        <section aria-label="Nudge" className="flex flex-col gap-2">
          <h3 className="font-mono text-meta tracking-caps text-label-2 uppercase">Nudge</h3>
          <div className="divide-y divide-outline-quiet overflow-hidden rounded-tile border border-outline-quiet bg-ground">
            {FADERS.map((f) => (
              <Fader
                key={f.key}
                name={f.name}
                labels={f.labels}
                value={stops[f.key]}
                onChange={(v) => setStop(f.key, v)}
                disabled={sending}
              />
            ))}
          </div>
        </section>

        {TILE_GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title} className="flex flex-col gap-2">
            <h3 className="font-mono text-meta tracking-caps text-label-2 uppercase">
              {group.title}
            </h3>
            <div role="group" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {group.reasons.map((reason) => (
                <ReasonTile
                  key={reason.code}
                  reason={reason}
                  on={picked.includes(reason.code)}
                  disabled={sending}
                  onToggle={() => toggle(reason.code)}
                />
              ))}
            </div>
          </section>
        ))}

        {shownError ? (
          <p role="alert" className="swap-in text-secondary text-red">
            {shownError}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
