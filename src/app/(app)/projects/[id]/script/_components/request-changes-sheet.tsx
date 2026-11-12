"use client";

import { useState } from "react";
import { Circle, CircleCheck } from "lucide-react";
import { Button, Field, GroupedList, GroupedListButton, Sheet, Textarea } from "@/ui";
import type { IssueChoice } from "./shared";

const MAX_NOTE_CHARS = 8000;

export function RequestChangesSheet({
  open,
  onOpenChange,
  issues,
  commentCount,
  sending,
  serverError,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issues: IssueChoice[];
  commentCount: number;
  sending: boolean;
  serverError: string | null;
  onSubmit: (input: { issueCodes: string[]; note: string }) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function toggle(code: string) {
    setError(null);
    setSelected((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  }

  function submit() {
    const trimmed = note.trim();
    if (selected.length === 0 && !trimmed && commentCount === 0) {
      setError("Choose an issue, write a note or comment on the script first.");
      return;
    }
    if (trimmed.length > MAX_NOTE_CHARS) {
      setError("Keep the note under 8,000 characters.");
      return;
    }
    onSubmit({ issueCodes: selected, note: trimmed });
  }

  const shownError = error ?? serverError;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Request Changes"
      description="Choose what is not working, add a note, or both. The script comes back revised for another review."
      footer={
        <>
          <Button variant="plain" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button variant="primary" loading={sending} onClick={submit}>
            Request Changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <GroupedList header="What Is Not Working">
          {issues.map((issue) => {
            const checked = selected.includes(issue.code);
            return (
              <GroupedListButton
                key={issue.code}
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(issue.code)}
                className="py-2.5"
                icon={
                  checked ? (
                    // Keyed so the tick settles in each time it is chosen.
                    <CircleCheck
                      key="on"
                      aria-hidden="true"
                      className="swap-in text-brand"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <Circle
                      key="off"
                      aria-hidden="true"
                      className="text-label-3"
                      strokeWidth={1.5}
                    />
                  )
                }
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-body text-label">{issue.label}</span>
                  <span className="text-secondary text-pretty text-label-2">{issue.hint}</span>
                </span>
              </GroupedListButton>
            );
          })}
        </GroupedList>

        <Field label="Note" optional>
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            placeholder="Anything else the next version should do."
            minRows={3}
            maxRows={8}
          />
        </Field>

        <p className="text-secondary text-pretty text-label-2 tabular-nums">
          {commentCount === 0
            ? "No comments on the script. Use Comment beside any line to add one."
            : commentCount === 1
              ? "Your comment on the script is sent with this request."
              : `Your ${commentCount} comments on the script are sent with this request.`}
        </p>

        {shownError ? (
          <p role="alert" className="swap-in text-secondary text-red">
            {shownError}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
