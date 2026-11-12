"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import {
  BlockSwapScene,
  Button,
  DemoHint,
  IssueDemo,
  Textarea,
  cn,
  issueScene,
  stagger,
} from "@/ui";
import { shake } from "./feedback";
import { formatNumber } from "./format";

export interface IssueChoice {
  code: string;
  label: string;
  hint: string;
}

/**
 * "What should change?": issue chips to toggle and a note; one of them is needed. It replaces
 * the decision buttons in place (no modal), and is mounted only while open, so it starts empty.
 * The heading takes focus when it appears.
 */
export function ChangeRequest({
  issues,
  maxNote,
  sending,
  serverError,
  onSubmit,
  onCancel,
  notePlaceholder,
  cost,
  blocked = false,
}: {
  issues: IssueChoice[];
  maxNote: number;
  sending: boolean;
  serverError: string | null;
  onSubmit: (input: { issueCodes: string[]; note: string }) => void;
  onCancel: () => void;
  notePlaceholder?: string;
  /** A plain line about the price, under the note. */
  cost?: ReactNode;
  /** Sending is not possible (for example, not enough credits). */
  blocked?: boolean;
}) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputsRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  function toggle(code: string) {
    setError(null);
    setSelected((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  }

  const trimmed = note.trim();
  const given = selected.length > 0 || trimmed.length > 0;

  function submit() {
    if (!given) {
      setError("Choose what is wrong, or write a note.");
      shake(inputsRef.current);
      return;
    }
    if (trimmed.length > maxNote) {
      setError(`Keep the note under ${formatNumber(maxNote)} characters.`);
      shake(inputsRef.current);
      return;
    }
    onSubmit({ issueCodes: selected, note: trimmed });
  }

  const shownError = error ?? serverError;

  return (
    <div data-change-request="" className="flex swap-in flex-col gap-6">
      {/* The heading row is the demo's hover target: a block's card swapped for its next version. */}
      <div className="demo-host flex items-center justify-between gap-6">
        <h3
          ref={headingRef}
          tabIndex={-1}
          id={`${id}-title`}
          className="text-heading-sm text-balance outline-none"
        >
          What should change?
        </h3>
        <span className="demo-blockswap-slot">
          <DemoHint mask="none">
            <BlockSwapScene />
          </DemoHint>
        </span>
      </div>
      <div ref={inputsRef} className="flex flex-col gap-6">
        <div role="group" aria-labelledby={`${id}-title`} className="flex flex-wrap gap-2">
          {issues.map((issue, i) => {
            const on = selected.includes(issue.code);
            return (
              <button
                key={issue.code}
                type="button"
                aria-pressed={on}
                title={issue.hint}
                onClick={() => toggle(issue.code)}
                style={stagger(i, 60)}
                className={cn(
                  "inline-flex min-h-(--btn-sm) press enter items-center gap-1.5 rounded-capsule border py-1.5 pr-3.5 text-secondary font-medium focus-ring",
                  on
                    ? "border-brand bg-selected pl-2.5 text-label"
                    : "border-outline pl-3.5 text-label-2 hover:bg-fill-4 hover:text-label",
                  // A chip with a picture of its issue is the picture's hover/focus target.
                  issueScene(issue.code) !== null && "demo-host pl-2.5",
                )}
              >
                {on ? (
                  <Check aria-hidden strokeWidth={1.5} className="size-(--icon) text-brand" />
                ) : null}
                <IssueDemo code={issue.code} />
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
            placeholder={notePlaceholder}
            minRows={3}
            maxRows={8}
          />
        </div>
      </div>
      {cost}
      {shownError ? (
        <p role="alert" className="text-secondary text-failed">
          {shownError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Button
          variant={given && !blocked ? "primary" : "outlined"}
          size="large"
          loading={sending}
          disabled={blocked}
          onClick={submit}
        >
          Send Back
        </Button>
        <Button variant="plain" size="large" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
