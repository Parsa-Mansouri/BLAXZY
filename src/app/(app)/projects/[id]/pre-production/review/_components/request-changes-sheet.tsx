"use client";

import { useId, useState } from "react";
import { Check } from "lucide-react";
import { Button, Field, Sheet, Textarea, cn } from "@/ui";

export interface IssueChoice {
  code: string;
  label: string;
  hint: string;
}

const MAX_NOTE_CHARS = 2000;

/** What is wrong with a sheet: issues to tick and an optional note. */
export function RequestChangesSheet({
  open,
  onOpenChange,
  assetName,
  issues,
  sending,
  serverError,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetName: string;
  issues: IssueChoice[];
  sending: boolean;
  serverError: string | null;
  onSubmit: (input: { issueCodes: string[]; note: string }) => void;
}) {
  const id = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function toggle(code: string) {
    setError(null);
    setSelected((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  }

  function changeOpen(next: boolean) {
    if (!next) {
      setSelected([]);
      setNote("");
      setError(null);
    }
    onOpenChange(next);
  }

  function submit() {
    const trimmed = note.trim();
    if (selected.length === 0 && !trimmed) {
      setError("Choose an issue or write a note.");
      return;
    }
    if (trimmed.length > MAX_NOTE_CHARS) {
      setError("Keep the note under 2,000 characters.");
      return;
    }
    onSubmit({ issueCodes: selected, note: trimmed });
  }

  const shownError = error ?? serverError;

  return (
    <Sheet
      open={open}
      onOpenChange={changeOpen}
      size="lg"
      title="Request Changes"
      description={`${assetName} leaves this pass and its sheet is built again from what you choose.`}
      footer={
        <>
          <Button variant="plain" onClick={() => changeOpen(false)} disabled={sending}>
            Cancel
          </Button>
          <Button variant="prominent" loading={sending} onClick={submit}>
            Request Changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div role="group" aria-labelledby={`${id}-issues`} className="flex flex-col gap-1.5">
          <h3 id={`${id}-issues`} className="px-3 text-headline">
            What Is Not Working
          </h3>
          <div className="flex max-h-[40dvh] flex-col overflow-y-auto rounded-group bg-fill-4">
            {issues.map((issue) => {
              const checked = selected.includes(issue.code);
              return (
                <button
                  key={issue.code}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(issue.code)}
                  className={cn(
                    "relative flex w-full items-start gap-3 px-3 py-2 text-left focus-ring focus-visible:-outline-offset-2",
                    "before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-(--hairline) before:bg-separator first:before:hidden",
                    "transition-colors duration-(--dur-fast) hover:bg-fill-4 active:bg-fill-3",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-px flex size-4 shrink-0 items-center justify-center rounded-full transition-colors duration-(--dur-fast)",
                      checked ? "bg-accent text-on-accent" : "bg-fill-2",
                    )}
                  >
                    {checked ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-body text-label">{issue.label}</span>
                    <span className="text-callout text-label-2">{issue.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Note" optional>
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
            placeholder="Anything else the next sheet should do."
            minRows={3}
            maxRows={8}
          />
        </Field>

        {shownError ? (
          <p role="alert" className="text-callout text-red">
            {shownError}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
