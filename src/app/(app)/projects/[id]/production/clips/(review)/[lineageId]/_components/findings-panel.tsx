"use client";

import { useState, type MutableRefObject } from "react";
import { Button, Input, ProgressBar, Spinner } from "@/ui";
import { formatClock } from "../../../_lib/clip-view";
import {
  MAX_TIMED_NOTES,
  rangeLabel,
  toggled,
  withTimedNote,
  type Finding,
  type KeepPoint,
  type TimedNote,
} from "../../../_lib/take-feedback";

/** The line shown while the clip is being checked. */
export function CheckingLine() {
  return (
    <div role="status" className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-body text-label-2">
        <Spinner size="sm" label="Checking the clip" />
        Checking the clip…
      </p>
      <ProgressBar value={null} aria-label="Checking the clip" className="max-w-xs" />
    </div>
  );
}

/**
 * What the check found, as sentences the user can dismiss one by one (a finding left standing is
 * confirmed and goes into the change request), the parts that look good (kept unless unticked),
 * and notes on a stretch of the clip marked with the playhead. Controlled: the screen holds the
 * choices and sends them with the request.
 */
export function FindingsEditor({
  findings,
  keeps,
  dismissed,
  dropped,
  timedNotes,
  clipLength,
  timeRef,
  disabled,
  onDismissed,
  onDropped,
  onTimedNotes,
}: {
  findings: readonly Finding[];
  keeps: readonly KeepPoint[];
  dismissed: ReadonlySet<string>;
  dropped: ReadonlySet<string>;
  timedNotes: readonly TimedNote[];
  /** The clip's length in seconds, 0 when not known yet. */
  clipLength: number;
  timeRef: MutableRefObject<(() => number) | null>;
  disabled: boolean;
  onDismissed: (next: Set<string>) => void;
  onDropped: (next: Set<string>) => void;
  onTimedNotes: (next: TimedNote[]) => void;
}) {
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [text, setText] = useState("");
  const now = () => timeRef.current?.() ?? 0;
  const canAdd =
    from !== null && to !== null && text.trim() !== "" && timedNotes.length < MAX_TIMED_NOTES;

  function addNote() {
    const next = withTimedNote(timedNotes, { fromS: from, toS: to, text }, clipLength);
    if (next.length === timedNotes.length) return;
    onTimedNotes(next);
    setFrom(null);
    setTo(null);
    setText("");
  }

  return (
    <div className="flex flex-col gap-6">
      {findings.length > 0 ? (
        <section aria-labelledby="findings-title" className="flex flex-col gap-2">
          <h4 id="findings-title" className="text-label text-label-2">
            What we noticed
          </h4>
          <ul className="flex flex-col divide-y divide-separator">
            {findings.map((f) => {
              const off = dismissed.has(f.id);
              return (
                <li key={f.id} className="flex items-start justify-between gap-4 py-2.5">
                  <p
                    className={
                      off
                        ? "text-body text-pretty text-label-3 line-through"
                        : "text-body text-pretty"
                    }
                  >
                    {f.label}{" "}
                    <span className="text-label-2 tabular-nums">
                      ({rangeLabel(f.fromS, f.toS)})
                    </span>
                  </p>
                  <Button
                    variant="plain"
                    disabled={disabled}
                    aria-pressed={off}
                    onClick={() => onDismissed(toggled(dismissed, f.id))}
                    className="shrink-0"
                  >
                    {off ? "Undo" : "Dismiss"}
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="text-secondary text-label-2">
            Anything you leave here is sent with your changes.
          </p>
        </section>
      ) : null}

      {keeps.length > 0 ? (
        <section aria-labelledby="keeps-title" className="flex flex-col gap-2">
          <h4 id="keeps-title" className="text-label text-label-2">
            Looks good
          </h4>
          <ul className="flex flex-col divide-y divide-separator">
            {keeps.map((k) => {
              const kept = !dropped.has(k.id);
              return (
                <li key={k.id} className="flex items-start justify-between gap-4 py-2.5">
                  <p className="text-body text-pretty">{k.label}</p>
                  <Button
                    variant="plain"
                    disabled={disabled}
                    aria-pressed={kept}
                    onClick={() => onDropped(toggled(dropped, k.id))}
                    className="shrink-0"
                  >
                    {kept ? "Keeping" : "Keep"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="timed-title" className="flex flex-col gap-3">
        <h4 id="timed-title" className="text-label text-label-2">
          A note on part of the clip
        </h4>
        {timedNotes.length > 0 ? (
          <ul className="flex flex-col divide-y divide-separator">
            {timedNotes.map((n, i) => (
              <li
                key={`${n.fromS}-${n.toS}-${i}`}
                className="flex items-start justify-between gap-4 py-2.5"
              >
                <p className="text-body text-pretty">
                  <span className="text-label-2 tabular-nums">{rangeLabel(n.fromS, n.toS)}</span>
                  {" · "}
                  {n.text}
                </p>
                <Button
                  variant="plain"
                  disabled={disabled}
                  onClick={() => onTimedNotes(timedNotes.filter((_, j) => j !== i))}
                  className="shrink-0"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-secondary text-pretty text-label-2">
          Play or pause the clip where the part starts, press Mark From Here, then do the same where
          it ends.
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button disabled={disabled} onClick={() => setFrom(now())}>
            Mark From Here
          </Button>
          <span className="min-w-[5ch] text-meta text-label-2 tabular-nums">
            {from === null ? "–" : formatClock(from)}
          </span>
          <Button disabled={disabled} onClick={() => setTo(now())}>
            Mark To Here
          </Button>
          <span className="min-w-[5ch] text-meta text-label-2 tabular-nums">
            {to === null ? "–" : formatClock(to)}
          </span>
        </div>
        <Input
          aria-label="What should change in this part"
          placeholder="What should change in this part?"
          value={text}
          maxLength={2000}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAdd) {
              e.preventDefault();
              addNote();
            }
          }}
        />
        <div>
          <Button disabled={disabled || !canAdd} onClick={addNote}>
            Add Note
          </Button>
        </div>
      </section>
    </div>
  );
}
