"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { cn } from "./cn";
import { Field } from "./Field";
import { Textarea } from "./Textarea";

export interface ChangeRequestBoxProps {
  /** Longest note accepted, in characters (the counter counts the trimmed-or-not text typed). */
  maxLength?: number;
  /** A concrete example for this screen, shown while the box is empty. */
  placeholder: string;
  /** Label above the box. Default "Tell us what to change". */
  label?: string;
  /** Text of the send button. Default "Send Changes". */
  submitLabel?: string;
  /** Text for an empty send. Default "Tell us what to change." */
  emptyMessage?: string;
  /** Prefilled text. */
  initialNote?: string;
  /** A send is in flight: the button spins and the box is locked. */
  sending?: boolean;
  /** An error from the server for the last send. */
  serverError?: string | null;
  /** Sending is not possible right now (for example, not enough credits). */
  blocked?: boolean;
  /** An empty note may be sent (something else carries the request, such as line comments). */
  allowEmpty?: boolean;
  /** Focus the box when it appears. */
  autoFocus?: boolean;
  /** Extra content between the box and the buttons (a price line, a note about comments). */
  children?: ReactNode;
  /** The user typed: a screen clears the errors it shows itself. */
  onEdit?: () => void;
  onSubmit: (note: string) => void;
  /**
   * A second way to send, beside the first (for example "Regenerate this block"): it hands the
   * trimmed note (possibly empty) to `onSelect`, so the note stays optional for it.
   */
  secondaryAction?: { label: string; onSelect: (note: string) => void };
  onCancel: () => void;
  className?: string;
}

/**
 * Where a change request is written, on every review screen: one box, in the user's own words,
 * with a character counter, a send and a cancel. It checks an empty or too long note itself and
 * hands the trimmed text to `onSubmit`. Not a form of reasons: no chips, lists or sliders.
 */
export function ChangeRequestBox({
  maxLength = 2000,
  placeholder,
  label = "Tell us what to change",
  submitLabel = "Send Changes",
  emptyMessage = "Tell us what to change.",
  initialNote = "",
  sending = false,
  serverError = null,
  blocked = false,
  allowEmpty = false,
  autoFocus = true,
  children,
  onEdit,
  onSubmit,
  secondaryAction,
  onCancel,
  className,
}: ChangeRequestBoxProps) {
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const over = note.length > maxLength;
  const shownError = error ?? serverError;

  function submit() {
    const trimmed = note.trim();
    if (!trimmed && !allowEmpty) {
      setError(emptyMessage);
      return;
    }
    if (trimmed.length > maxLength) {
      setError(`Keep it under ${maxLength.toLocaleString("en-US")} characters.`);
      return;
    }
    onSubmit(trimmed);
  }

  function submitSecondary() {
    const trimmed = note.trim();
    if (trimmed.length > maxLength) {
      setError(`Keep it under ${maxLength.toLocaleString("en-US")} characters.`);
      return;
    }
    secondaryAction?.onSelect(trimmed);
  }

  return (
    <div data-change-request="" className={cn("flex flex-col gap-4", className)}>
      <Field
        label={label}
        error={shownError}
        hint={
          <span className={cn("tabular-nums", over && "text-red")}>
            {note.length.toLocaleString("en-US")} / {maxLength.toLocaleString("en-US")}
          </span>
        }
        disabled={sending}
      >
        <Textarea
          autoFocus={autoFocus}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
            onEdit?.();
          }}
          placeholder={placeholder}
          minRows={4}
          maxRows={10}
        />
      </Field>
      {children}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Button
          variant={note.trim() && !blocked ? "primary" : "outlined"}
          size="large"
          loading={sending}
          disabled={blocked || over}
          onClick={submit}
        >
          {submitLabel}
        </Button>
        {secondaryAction ? (
          <Button
            variant="outlined"
            size="large"
            disabled={blocked || over || sending}
            onClick={submitSecondary}
          >
            {secondaryAction.label}
          </Button>
        ) : null}
        <Button variant="plain" size="large" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
