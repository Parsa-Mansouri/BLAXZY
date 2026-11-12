"use client";

import { useId, useState, type ComponentType, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Button, Field, IconButton, IssueDemo, Textarea, cn, issueScene, stagger } from "@/ui";
import {
  ErrorLine,
  PriceLine,
  canAfford,
  formatNumber,
  type IssueChoice,
} from "../assets/[assetId]/_components/shared";
import {
  MAX_MARKS,
  MAX_MARK_TEXT,
  firstBlankMark,
  foldMarks,
  groupIssues,
  regionWords,
} from "../_lib/marks";
import { focusSoon, markFieldId, markPinId, type Marking } from "./mark-layer";

type HeadingProps = { id?: string; className?: string; children: ReactNode };

function PlainHeading({ id, className, children }: HeadingProps) {
  return (
    <h2 id={id} className={className}>
      {children}
    </h2>
  );
}

/** The small mono capitals over each part of the panel. */
function Caps({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="font-mono text-meta tracking-caps text-label-2 uppercase">
      {children}
    </span>
  );
}

/** The small square check in a tile's corner; fills brand when on. */
function SquareCheck({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[3px] border transition-colors duration-(--dur-press) motion-reduce:transition-none",
        on ? "border-brand bg-brand" : "border-outline",
      )}
    >
      {on ? (
        <svg viewBox="0 0 10 10" className="size-2.5 text-ground" fill="none">
          <path d="M2 5.2 4.2 7.4 8 2.8" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ) : null}
    </span>
  );
}

/** One issue as a square tile: its moving picture on top, its name below, a check in the corner. */
function IssueTile({
  issue,
  on,
  disabled,
  index,
  onToggle,
}: {
  issue: IssueChoice;
  on: boolean;
  disabled: boolean;
  index: number;
  onToggle: () => void;
}) {
  const pictured = issueScene(issue.code) !== null;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      title={issue.hint}
      disabled={disabled}
      onClick={onToggle}
      style={stagger(index, 60, 30)}
      className={cn(
        // The tile is the picture's hover/focus target, so the demo plays on hover and focus.
        "relative flex min-h-28 press enter flex-col justify-between gap-4 rounded-item border p-3 text-left",
        "transition-colors duration-(--dur-press) motion-reduce:transition-none",
        pictured && "demo-host",
        on
          ? "border-brand bg-brand/10 text-label"
          : "border-outline-quiet bg-elevated text-label-2 hover:border-outline hover:text-label",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        {pictured ? (
          <IssueDemo
            code={issue.code}
            className={cn("size-10", on && "[--demo-ink:var(--brand)]")}
          />
        ) : (
          <span />
        )}
        <SquareCheck on={on} />
      </span>
      <span className="text-secondary text-balance">{issue.label}</span>
    </button>
  );
}

/** The marks on the picture, one row each: number, where, and what is wrong there. */
function MarkList({
  marking,
  subject,
  disabled,
}: {
  marking: Marking;
  subject: "image" | "sheet";
  disabled: boolean;
}) {
  const id = useId();
  const { marks } = marking;
  const full = marks.length >= MAX_MARKS;

  function addCentre() {
    const added = marking.add();
    if (added) focusSoon(markPinId(added));
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Caps id={`${id}-title`}>On the {subject}</Caps>
        {marks.length > 0 ? (
          <span className="font-mono text-meta text-label-3 tabular-nums">
            {marks.length}/{MAX_MARKS}
          </span>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-tile border border-outline-quiet bg-ground">
        {marks.length === 0 ? (
          <p className="px-4 pt-3.5 text-secondary text-pretty text-label-2">
            Click or tap the {subject} to pin a spot, then say what is wrong there.
          </p>
        ) : (
          <ol className="divide-y divide-outline-quiet">
            {marks.map((mark, i) => {
              const n = i + 1;
              const where = regionWords(mark.x, mark.y);
              const on = marking.active === mark.id;
              return (
                <li
                  key={mark.id}
                  onPointerEnter={() => marking.setActive(mark.id)}
                  onPointerLeave={() => marking.setActive(null)}
                  className={cn(
                    "flex swap-in items-center gap-3 py-2 pr-1.5 pl-3 transition-colors duration-(--dur-press) motion-reduce:transition-none",
                    on && "bg-brand/10",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-inset bg-brand font-mono text-meta font-semibold text-ground tabular-nums"
                  >
                    {n}
                  </span>
                  <label className="flex min-w-0 flex-1 flex-col">
                    <span className="font-mono text-meta tracking-caps text-label-3 uppercase">
                      {where}
                    </span>
                    <input
                      id={markFieldId(mark.id)}
                      value={mark.text}
                      maxLength={MAX_MARK_TEXT}
                      disabled={disabled}
                      aria-label={`Mark ${n}, ${where}: what is wrong here?`}
                      placeholder="What is wrong here?"
                      onFocus={() => marking.setActive(mark.id)}
                      onChange={(e) => marking.setText(mark.id, e.target.value)}
                      className="min-w-0 bg-transparent py-0.5 text-body text-label outline-none placeholder:text-label-3 disabled:text-label-3"
                    />
                  </label>
                  <IconButton
                    label={`Remove mark ${n}`}
                    icon={<X />}
                    size="small"
                    tooltip={false}
                    disabled={disabled}
                    onClick={() => marking.remove(mark.id)}
                  />
                </li>
              );
            })}
          </ol>
        )}
        <div
          className={cn(
            "px-2 pb-2",
            marks.length > 0 ? "border-t border-outline-quiet pt-2" : "pt-1.5",
          )}
        >
          <Button
            variant="plain"
            size="small"
            leadingIcon={<Plus />}
            disabled={disabled || full}
            onClick={addCentre}
          >
            {full ? `Up to ${MAX_MARKS} marks` : "Add a Mark"}
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * "What should change?", in place of the decision it replaces (no modal): the note first, then
 * marks on the picture (when the picture beside it takes them), then the issues that apply to this
 * kind of asset as square tiles in groups. Any one of the three is enough; the marks are folded
 * into the note, so the submit stays `{ issueCodes, note }`. Mounted only while open.
 */
export function RequestChangesPanel({
  subject,
  issues,
  maxNote,
  sending,
  serverError,
  price = null,
  balance = 0,
  marking,
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
  /** The marks on the picture shown with the panel; leave out where the picture takes none. */
  marking?: Marking;
  onSubmit: (input: { issueCodes: string[]; note: string }) => void;
  onCancel: () => void;
  /** The heading element, e.g. one that takes focus when the panel arrives. */
  headingAs?: ComponentType<HeadingProps>;
}) {
  const id = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const marks = marking?.marks ?? [];
  const given = selected.length > 0 || note.trim().length > 0 || marks.length > 0;
  const affordable = canAfford(price, balance);
  const groups = groupIssues(issues);

  function toggle(code: string) {
    setError(null);
    setSelected((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  }

  function submit() {
    if (!given) {
      setError(
        marking
          ? `Write a note, mark the ${subject} or choose what is wrong.`
          : "Write a note or choose what is wrong.",
      );
      return;
    }
    const blank = firstBlankMark(marks);
    const blankMark = blank === null ? undefined : marks[blank - 1];
    if (blankMark) {
      setError(`Say what is wrong at mark ${blank}.`);
      focusSoon(markFieldId(blankMark.id));
      return;
    }
    const folded = foldMarks(note, marks, subject);
    if (folded.length > maxNote) {
      setError(
        marks.length > 0
          ? `Keep the note and the marks under ${formatNumber(maxNote)} characters together.`
          : `Keep the note under ${formatNumber(maxNote)} characters.`,
      );
      return;
    }
    onSubmit({ issueCodes: selected, note: folded });
  }

  let tileIndex = 0;

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <Heading id={`${id}-title`} className="text-heading-sm text-balance">
        What should change?
      </Heading>

      <Field label={<Caps>Your note</Caps>}>
        <Textarea
          autoFocus
          placeholder={`What should the next ${subject} do differently?`}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
          minRows={3}
          maxRows={8}
          disabled={sending}
        />
      </Field>

      {marking ? <MarkList marking={marking} subject={subject} disabled={sending} /> : null}

      {groups.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`${id}-${group.key}`}
          className="flex flex-col gap-2"
        >
          <Caps id={`${id}-${group.key}`}>{group.label}</Caps>
          <div
            role="group"
            aria-labelledby={`${id}-${group.key}`}
            className="grid grid-cols-2 gap-2"
          >
            {group.issues.map((issue) => (
              <IssueTile
                key={issue.code}
                issue={issue}
                on={selected.includes(issue.code)}
                disabled={sending}
                index={tileIndex++}
                onToggle={() => toggle(issue.code)}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="flex flex-col gap-4">
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
    </div>
  );
}
