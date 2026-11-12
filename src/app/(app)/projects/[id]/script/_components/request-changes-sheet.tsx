"use client";

import { useState } from "react";
import { Button, Field, Sheet, Textarea, cn } from "@/ui";
import type { ScriptIssueCode } from "@/server/damis/script-reviser/issues";
import { Fader, type FaderStop } from "./fader";

const MAX_NOTE_CHARS = 8000;

type FaderKey = "pace" | "length" | "talk";

/** The three nudges: stop labels (-1, 0, +1) and the issue code each non-zero stop sends. */
const FADERS: readonly {
  key: FaderKey;
  name: string;
  labels: readonly [string, string, string];
  codes: { [-1]: ScriptIssueCode; 1: ScriptIssueCode };
}[] = [
  {
    key: "pace",
    name: "Pace",
    labels: ["Let it breathe", "As is", "Speed it up"],
    codes: { [-1]: "pacing_rushed", 1: "pacing_slow" },
  },
  {
    key: "length",
    name: "Length",
    labels: ["Shorter", "As is", "Longer"],
    codes: { [-1]: "too_long", 1: "too_short" },
  },
  {
    key: "talk",
    name: "Talk",
    labels: ["Less talk", "As is", "More talk"],
    codes: { [-1]: "too_much_dialogue", 1: "too_little_dialogue" },
  },
];

/** The four things to fix, as tiles. */
const TILES: readonly { label: string; code: ScriptIssueCode }[] = [
  { label: "Opening", code: "opening_weak" },
  { label: "Ending", code: "ending_weak" },
  { label: "Tone", code: "tone_off" },
  { label: "Story logic", code: "plot_hole" },
];

export function RequestChangesSheet({
  open,
  onOpenChange,
  commentCount,
  sending,
  serverError,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commentCount: number;
  sending: boolean;
  serverError: string | null;
  onSubmit: (input: { issueCodes: string[]; note: string }) => void;
}) {
  const [stops, setStops] = useState<Record<FaderKey, FaderStop>>({
    pace: 0,
    length: 0,
    talk: 0,
  });
  const [picked, setPicked] = useState<ScriptIssueCode[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function setStop(key: FaderKey, value: FaderStop) {
    setError(null);
    setStops((s) => ({ ...s, [key]: value }));
  }

  function toggle(code: ScriptIssueCode) {
    setError(null);
    setPicked((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  }

  function submit() {
    const trimmed = note.trim();
    const codes: ScriptIssueCode[] = [];
    for (const fader of FADERS) {
      const stop = stops[fader.key];
      if (stop !== 0) codes.push(fader.codes[stop]);
    }
    codes.push(...TILES.map((t) => t.code).filter((c) => picked.includes(c)));
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

        <div role="group" aria-label="Fix" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TILES.map((tile) => {
            const on = picked.includes(tile.code);
            return (
              <button
                key={tile.code}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={sending}
                onClick={() => toggle(tile.code)}
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
                {tile.label}
              </button>
            );
          })}
        </div>

        {shownError ? (
          <p role="alert" className="swap-in text-secondary text-red">
            {shownError}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
