"use client";

import { useId, useState, type ComponentType, type ReactNode } from "react";
import { Button, Textarea, cn, stagger } from "@/ui";
import {
  ErrorLine,
  PriceLine,
  canAfford,
  formatNumber,
  type IssueChoice,
} from "../assets/[assetId]/_components/shared";

type HeadingProps = { id?: string; className?: string; children: ReactNode };

function PlainHeading({ id, className, children }: HeadingProps) {
  return (
    <h2 id={id} className={className}>
      {children}
    </h2>
  );
}

/**
 * "What should change?": issue chips to toggle and a note, in place of the decision it replaces
 * (no modal). One of the two is needed. Mounted only while open, so it starts empty.
 */
export function RequestChangesPanel({
  subject,
  issues,
  maxNote,
  sending,
  serverError,
  price = null,
  balance = 0,
  onSubmit,
  onCancel,
  headingAs: Heading = PlainHeading,
}: {
  subject: "image" | "sheet";
  issues: IssueChoice[];
  maxNote: number;
  sending: boolean;
  serverError: string | null;
  /** Credits for the new version and the balance; null when not known here. */
  price?: number | null;
  balance?: number;
  onSubmit: (input: { issueCodes: string[]; note: string }) => void;
  onCancel: () => void;
  /** The heading element, e.g. one that takes focus when the panel arrives. */
  headingAs?: ComponentType<HeadingProps>;
}) {
  const id = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const given = selected.length > 0 || note.trim().length > 0;
  const affordable = canAfford(price, balance);

  function toggle(code: string) {
    setError(null);
    setSelected((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  }

  function submit() {
    const trimmed = note.trim();
    if (!given) {
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
    <div className="flex flex-col gap-6">
      <Heading id={`${id}-title`} className="text-heading text-balance">
        What should change?
      </Heading>
      <div
        role="group"
        aria-label={
          subject === "image" ? "What is wrong with the image" : "What is wrong with the sheet"
        }
        className="flex flex-wrap gap-2"
      >
        {issues.map((issue, i) => {
          const on = selected.includes(issue.code);
          return (
            <button
              key={issue.code}
              type="button"
              aria-pressed={on}
              title={issue.hint}
              onClick={() => toggle(issue.code)}
              disabled={sending}
              className={cn(
                "min-h-(--btn-sm) press enter rounded-capsule border px-3.5 py-1.5 text-left text-secondary font-medium focus-ring",
                on
                  ? "border-label bg-selected text-label"
                  : "border-outline text-label-2 hover:text-label",
              )}
              style={stagger(i, 60)}
            >
              {issue.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-note`} className="text-secondary text-label-2">
          Anything else we should know?
        </label>
        <Textarea
          id={`${id}-note`}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
          minRows={3}
          maxRows={8}
          disabled={sending}
        />
      </div>
      <PriceLine price={price} balance={balance} action={subject} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Button
          variant={given ? "primary" : "dark"}
          size="large"
          loading={sending}
          disabled={!affordable}
          onClick={submit}
        >
          Send Back
        </Button>
        <Button variant="plain" size="large" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
      </div>
      <ErrorLine>{error ?? serverError}</ErrorLine>
    </div>
  );
}
