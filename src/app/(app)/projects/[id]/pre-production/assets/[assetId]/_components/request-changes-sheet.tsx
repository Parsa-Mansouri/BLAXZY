"use client";

import { useId, useState } from "react";
import { Check } from "lucide-react";
import { Button, Field, Sheet, Textarea, cn } from "@/ui";
import { ErrorLine, PriceLine, canAfford, formatNumber, type IssueChoice } from "./shared";

/** Issues to pick and a note; one of them is needed. Mounted only while open, so it starts empty. */
export function RequestChangesSheet({
  open,
  onOpenChange,
  subject,
  issues,
  maxNote,
  sending,
  serverError,
  price,
  balance,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: "image" | "sheet";
  issues: IssueChoice[];
  maxNote: number;
  sending: boolean;
  serverError: string | null;
  /** Credits for the new version and the balance. */
  price: number | null;
  balance: number;
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

  function submit() {
    const trimmed = note.trim();
    if (selected.length === 0 && !trimmed) {
      setError("Choose what is wrong, or write a note.");
      return;
    }
    if (trimmed.length > maxNote) {
      setError(`Keep the note under ${formatNumber(maxNote)} characters.`);
      return;
    }
    onSubmit({ issueCodes: selected, note: trimmed });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Request Changes"
      description={
        subject === "image"
          ? "Choose what is not right, add a note, or both. A new image is made with these fixes."
          : "Choose what is not right, add a note, or both. The sheet is built again with these fixes."
      }
      footer={
        <>
          <Button variant="plain" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            variant="prominent"
            loading={sending}
            disabled={!canAfford(price, balance)}
            onClick={submit}
          >
            Request Changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div role="group" aria-labelledby={`${id}-issues`} className="flex flex-col gap-1.5">
          <h3 id={`${id}-issues`} className="px-3 text-headline">
            What Is Not Right
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
            placeholder={
              subject === "image"
                ? "What the next image should do differently."
                : "What the next sheet should do differently."
            }
            minRows={3}
            maxRows={8}
          />
        </Field>

        <PriceLine price={price} balance={balance} action={subject} />
        <ErrorLine>{error ?? serverError}</ErrorLine>
      </div>
    </Sheet>
  );
}
