"use client";

import { useId } from "react";
import type { LookSpecView } from "@/server/assets";
import { Button, Input, cn } from "@/ui";
import { fieldName, groupSpecFields, type SpecField } from "../_lib/look-review";
import { Caps, CheckMark, ChoiceTile } from "./desk";
import { PriceLine } from "./shared";
import { ErrorLine } from "@/app/(app)/_components/values";

/** What the user did on the spec card, kept by the review screen. */
export interface SpecDraft {
  /** Critical inferred fields the user checked. */
  confirmed: string[];
  /** New values written per field (sent as `specEdits`). */
  edits: Record<string, string>;
  /** Answers to the designer's questions that differ from the ones it used. */
  clarify: Record<string, string>;
}

export const EMPTY_SPEC_DRAFT: SpecDraft = { confirmed: [], edits: {}, clarify: {} };

/** True when the card holds changes to send. */
export function specChanged(draft: SpecDraft): boolean {
  return Object.keys(draft.edits).length > 0 || Object.keys(draft.clarify).length > 0;
}

const STATUS_WORDS: Record<SpecField["status"], string> = {
  confirmed: "Confirmed",
  inferred: "Designed by BLAXZY",
  unknown: "Unknown",
};

function StatusMark({ field, checked }: { field: SpecField; checked: boolean }) {
  if (checked) {
    return (
      <span className="flex items-center gap-1.5 text-meta text-brand">
        <CheckMark on />
        Checked by you
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-meta",
        field.status === "confirmed"
          ? "text-label-2"
          : field.status === "unknown"
            ? "text-label-3"
            : "text-label-2",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          field.status === "confirmed"
            ? "bg-label-2"
            : field.status === "unknown"
              ? "border border-label-3"
              : "bg-brand",
        )}
      />
      {STATUS_WORDS[field.status]}
    </span>
  );
}

/** One field: its name, its value (or the new one being written) and what to do with it. */
function SpecRow({
  field,
  mustCheck,
  draft,
  disabled,
  onChange,
}: {
  field: SpecField;
  mustCheck: boolean;
  draft: SpecDraft;
  disabled: boolean;
  onChange: (next: SpecDraft) => void;
}) {
  const name = fieldName(field.field);
  const editing = field.field in draft.edits;
  const checked = draft.confirmed.includes(field.field);
  const open = mustCheck && !checked && !editing;

  function setEdit(value: string | null) {
    const edits = { ...draft.edits };
    if (value === null) delete edits[field.field];
    else edits[field.field] = value;
    onChange({
      ...draft,
      edits,
      confirmed: draft.confirmed.filter((f) => f !== field.field),
    });
  }

  return (
    <li
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-2 border-t border-outline-quiet px-4 py-3 first:border-t-0 @lg:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)]",
        open && "bg-brand/6 shadow-[inset_2px_0_0_var(--brand)]",
      )}
    >
      <span className="pt-0.5 font-mono text-meta tracking-caps break-words text-label-2 uppercase">
        {name}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        {editing ? (
          <Input
            aria-label={`New value for ${name}`}
            value={draft.edits[field.field] ?? ""}
            onChange={(e) => setEdit(e.target.value)}
            disabled={disabled}
            autoFocus
          />
        ) : (
          <p className="text-body text-pretty break-words text-label">
            {field.value.trim() || "Not set"}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {editing ? (
            <span className="text-meta text-label-2">Sent with your changes</span>
          ) : (
            <StatusMark field={field} checked={checked} />
          )}
          {open ? (
            <Button
              variant="outlined"
              size="small"
              disabled={disabled}
              onClick={() => onChange({ ...draft, confirmed: [...draft.confirmed, field.field] })}
            >
              Looks Right
            </Button>
          ) : null}
          {editing ? (
            <Button variant="plain" size="small" disabled={disabled} onClick={() => setEdit(null)}>
              Undo
            </Button>
          ) : (
            <Button
              variant="plain"
              size="small"
              disabled={disabled}
              onClick={() => setEdit(field.value)}
            >
              Change
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The designer's specification of a location or prop: its fields in groups, each with how sure
 * the designer is. Critical fields the designer filled in itself are highlighted and must be
 * checked ("Looks Right") or changed before the image can be accepted. Changed values and other
 * answers to the designer's questions go back together with "Send Changes" (a fix round).
 */
export function SpecCard({
  spec,
  toConfirm,
  answered,
  draft,
  disabled,
  sending,
  error,
  price,
  balance,
  onChange,
  onSend,
}: {
  spec: LookSpecView;
  /** The critical inferred fields to check before accepting. */
  toConfirm: readonly string[];
  /** The answers the designer used, per question id. */
  answered: Record<string, string> | null;
  draft: SpecDraft;
  disabled: boolean;
  sending: boolean;
  error: string | null;
  price: number | null;
  balance: number;
  onChange: (next: SpecDraft) => void;
  onSend: () => void;
}) {
  const id = useId();
  const groups = groupSpecFields(spec.fields);
  const questions = spec.questions;
  const changed = specChanged(draft);
  const left = toConfirm.filter((f) => !draft.confirmed.includes(f) && !(f in draft.edits));
  if (spec.fields.length === 0 && questions.length === 0) return null;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="@container flex flex-col gap-5 rounded-block border border-outline-quiet bg-ground p-5"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id={`${id}-title`} className="text-heading-sm">
            Specification
          </h3>
          {left.length > 0 ? (
            <p className="text-meta text-brand">
              {left.length === 1 ? "One field to check" : "Some fields to check"}
            </p>
          ) : null}
        </div>
        {spec.summary ? (
          <p className="max-w-(--measure) text-body text-pretty text-label-2">{spec.summary}</p>
        ) : null}
        {spec.styleUsed ? <p className="text-meta text-label-3">Style · {spec.styleUsed}</p> : null}
      </header>

      {groups.map((group) => (
        <div key={group.label ?? "fields"} className="flex flex-col gap-2">
          {group.label ? <Caps as="h4">{group.label}</Caps> : null}
          <ul className="overflow-hidden rounded-tile border border-outline-quiet">
            {group.fields.map((field) => (
              <SpecRow
                key={field.field}
                field={field}
                mustCheck={toConfirm.includes(field.field)}
                draft={draft}
                disabled={disabled}
                onChange={onChange}
              />
            ))}
          </ul>
        </div>
      ))}

      {questions.length > 0 ? (
        <div className="flex flex-col gap-4">
          <Caps as="h4">What the designer settled</Caps>
          {questions.map((q) => {
            const used = answered?.[q.id] ?? q.default;
            const current = draft.clarify[q.id] ?? used;
            const options = q.options.includes(used) ? q.options : [used, ...q.options];
            return (
              <div key={q.id} className="flex flex-col gap-2">
                <p id={`${id}-${q.id}`} className="text-body text-pretty text-label">
                  {q.question}
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby={`${id}-${q.id}`}
                  className="grid grid-cols-2 gap-2 @xl:grid-cols-3"
                >
                  {options.map((option) => (
                    <ChoiceTile
                      key={option}
                      label={option}
                      on={current === option}
                      disabled={disabled}
                      onPick={() => {
                        const clarify = { ...draft.clarify };
                        if (option === used) delete clarify[q.id];
                        else clarify[q.id] = option;
                        onChange({ ...draft, clarify });
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {changed ? (
        <div className="flex swap-in flex-col items-start gap-3 border-t border-outline-quiet pt-4">
          <p className="text-secondary text-pretty text-label-2">
            Your changes go back to the designer, and a new image is made with them.
          </p>
          <PriceLine price={price} balance={balance} action="image" />
          <Button variant="outlined" size="large" loading={sending} onClick={onSend}>
            Send Changes
          </Button>
          <ErrorLine>{error}</ErrorLine>
        </div>
      ) : null}
    </section>
  );
}
