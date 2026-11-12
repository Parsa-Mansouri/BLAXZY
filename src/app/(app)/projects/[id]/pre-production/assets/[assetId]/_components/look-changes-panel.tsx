"use client";

import { useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { LookView } from "@/server/assets";
import type { FixSelection, ReviewOption } from "@/server/damis";
import { Button, Field, TextLink, Textarea, cn } from "@/ui";
import { MarkList } from "../../../_components/request-changes-panel";
import { focusSoon, markFieldId, type Marking } from "../../../_components/mark-layer";
import { firstBlankMark, foldMarks } from "../../../_lib/marks";
import type { DesignerInfo } from "../_lib/designer-view";
import {
  buildLookSelections,
  EMPTY_LOOK_DRAFT,
  findReferenceConflict,
  followupChips,
  hasStrip,
  needsAnswer,
  nextReferences,
  optionLabel,
  optionsFor,
  regenerateOption,
  takesText,
  type LookReference,
  type LookReviewDraft,
  type LookSide,
  type ReferenceConflict,
} from "../_lib/look-review";
import type { ReferencePhoto } from "../actions";
import { Caps, CheckTile, ChoiceTile } from "./desk";
import { ReferenceConflictChoice } from "./reference-conflict";
import { ErrorLine, PriceLine, canAfford, formatNumber } from "./shared";

type HeadingProps = { id?: string; className?: string; children: ReactNode };

const SIDES: readonly { side: LookSide; title: string; line: string }[] = [
  {
    side: "technical",
    title: "Something’s wrong",
    line: "Broken, missing, cut off or not what was asked.",
  },
  {
    side: "preference",
    title: "I’d like it different",
    line: "It works, but you want another take on it.",
  },
];

export interface LookChangesInput {
  selections: FixSelection[];
  note: string;
  /** The next version's photos, when one was replaced or dropped. */
  references?: ReferencePhoto[];
}

/** The reasons of one side, in the catalog's groups (props) or as one list. */
function groupedReasons(
  options: readonly ReviewOption[],
  groups: DesignerInfo["groups"],
): { id: string; label: string | null; options: ReviewOption[] }[] {
  const grouped = new Map<string, ReviewOption[]>();
  for (const option of options) {
    const key = option.group ?? "";
    grouped.set(key, [...(grouped.get(key) ?? []), option]);
  }
  if (grouped.size <= 1) return [{ id: "all", label: null, options: [...options] }];
  const order = (key: string) => {
    const i = groups.findIndex((g) => g.id === key);
    return i === -1 ? groups.length : i;
  };
  return [...grouped.entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([key, list]) => ({
      id: key || "other",
      label: groups.find((g) => g.id === key)?.label ?? (key ? key : "Other"),
      options: list,
    }));
}

/** What one picked reason still needs: a chip, the user's words, the frame it is about. */
function ReasonStrip({
  option,
  draft,
  frames,
  disabled,
  highlight,
  onChange,
}: {
  option: ReviewOption;
  draft: LookReviewDraft;
  frames: DesignerInfo["frames"];
  disabled: boolean;
  highlight: boolean;
  onChange: (next: LookReviewDraft) => void;
}) {
  const id = useId();
  const code = option.code;
  const chips = followupChips(option);
  const text = takesText(option);
  const label = optionLabel(option);
  const required = needsAnswer(option);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex flex-col gap-4 border-t border-outline-quiet p-4 first:border-t-0",
        highlight && "bg-red/5",
      )}
    >
      <Caps as="h3" id={`${id}-title`}>
        {label}
      </Caps>
      {chips.length > 0 ? (
        <div role="radiogroup" aria-labelledby={`${id}-title`} className="grid grid-cols-2 gap-2">
          {chips.map((chip) => {
            const on = draft.values[code] === chip.value;
            return (
              <ChoiceTile
                key={chip.value}
                label={chip.label}
                on={on}
                disabled={disabled}
                onPick={() => {
                  const values = { ...draft.values };
                  if (on) delete values[code];
                  else values[code] = chip.value;
                  onChange({ ...draft, values });
                }}
              />
            );
          })}
        </div>
      ) : null}
      {text ? (
        <Field
          label={chips.length > 0 ? "Or in your own words" : "What should change?"}
          optional={!required || chips.length > 0}
        >
          <Textarea
            value={draft.texts[code] ?? ""}
            onChange={(e) =>
              onChange({ ...draft, texts: { ...draft.texts, [code]: e.target.value } })
            }
            disabled={disabled}
            minRows={1}
            maxRows={5}
          />
        </Field>
      ) : null}
      {frames.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p id={`${id}-where`} className="text-secondary text-label-2">
            Where is it? Leave it for the whole board.
          </p>
          <div role="radiogroup" aria-labelledby={`${id}-where`} className="grid grid-cols-3 gap-2">
            {frames.map((frame) => {
              const on = draft.views[code] === frame.id;
              return (
                <ChoiceTile
                  key={frame.id}
                  label={frame.label}
                  on={on}
                  disabled={disabled}
                  onPick={() => {
                    const views = { ...draft.views };
                    if (on) delete views[code];
                    else views[code] = frame.id;
                    onChange({ ...draft, views });
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * "What should change?" for a designer's image, in place of the decision (no modal): the kind of
 * problem as two large tiles, then its reasons from the designer's catalog as square tiles (in
 * groups for props); a picked reason that needs more opens a strip for its chip, its words and,
 * on a character board, the frame it is about. A free note and marks on the picture go with them
 * (the marks are folded into the note). A change that goes against a reference photo asks first.
 * "Try Again" re-rolls the same design and is sent on its own.
 */
export function LookChangesPanel({
  assetId,
  look,
  designer,
  rejectedInARow,
  maxNote,
  sending,
  serverError,
  price,
  balance,
  marking,
  onSubmit,
  onReroll,
  onCancel,
  headingAs: Heading,
}: {
  assetId: string;
  look: LookView;
  designer: DesignerInfo;
  rejectedInARow: number;
  maxNote: number;
  sending: boolean;
  serverError: string | null;
  price: number | null;
  balance: number;
  marking: Marking;
  onSubmit: (input: LookChangesInput) => void;
  onReroll: (code: string) => void;
  onCancel: () => void;
  headingAs: ComponentType<HeadingProps>;
}) {
  const id = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [side, setSide] = useState<LookSide | null>(null);
  const [draft, setDraft] = useState<LookReviewDraft>(EMPTY_LOOK_DRAFT);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  // A change that goes against a photo waits here for the user's choice.
  const [asking, setAsking] = useState<{
    conflict: ReferenceConflict;
    input: LookChangesInput;
  } | null>(null);
  const { options, frames } = designer;
  const marks = marking.marks;
  const reroll = regenerateOption(options);
  const affordable = canAfford(price, balance);
  const tried = rejectedInARow >= designer.maxAttempts;

  const picked = draft.picked
    .map((code) => options.find((o) => o.code === code))
    .filter((o): o is ReviewOption => o !== undefined);
  const strips = picked.filter((o) => hasStrip(o, frames));
  const otherPicks = picked.filter((o) => side !== null && o.kind !== side);
  const given = picked.length > 0 || draft.note.trim().length > 0 || marks.length > 0;

  function change(next: LookReviewDraft) {
    setError(null);
    setAsking(null);
    setDraft(next);
  }

  function toggle(code: string) {
    change({
      ...draft,
      picked: draft.picked.includes(code)
        ? draft.picked.filter((c) => c !== code)
        : [...draft.picked, code],
    });
  }

  function submit() {
    if (!given) {
      setError({ text: "Pick what is wrong, write a note or mark the image." });
      return;
    }
    const built = buildLookSelections(draft, options, maxNote);
    if (!built.ok) {
      setError({ text: built.error, code: built.code });
      return;
    }
    const blank = firstBlankMark(marks);
    const blankMark = blank === null ? undefined : marks[blank - 1];
    if (blankMark) {
      setError({ text: `Say what is wrong at mark ${blank}.` });
      focusSoon(markFieldId(blankMark.id));
      return;
    }
    const note = foldMarks(draft.note, marks, "image");
    if (note.length > maxNote) {
      setError({
        text:
          marks.length > 0
            ? `Keep the note and the marks under ${formatNumber(maxNote)} characters together.`
            : `Keep the note under ${formatNumber(maxNote)} characters.`,
      });
      return;
    }
    const input: LookChangesInput = { selections: built.selections, note };
    const conflict = findReferenceConflict(draft.picked, options, look.references, designer);
    if (conflict) {
      setError(null);
      setAsking({ conflict, input });
      return;
    }
    onSubmit(input);
  }

  function resolve(drop: readonly LookReference[], replacement?: { fileId: string }) {
    if (!asking) return;
    onSubmit({
      ...asking.input,
      references: nextReferences(look.references, drop, replacement),
    });
  }

  const reasons = side ? optionsFor(options, side) : [];
  const groups = groupedReasons(reasons, designer.groups);

  return (
    <div className="@container flex min-w-0 flex-col gap-7">
      <Heading id={`${id}-title`} className="text-heading-sm text-balance">
        What should change?
      </Heading>

      {tried ? (
        <div className="flex flex-col gap-2 border-l-2 border-brand pl-4">
          <p className="text-body text-pretty text-label">
            {designer.attemptMessage ??
              "We have tried a few times and it is still not right. A precise description usually settles it."}
          </p>
          <TextLink
            render={<button type="button" disabled={sending} />}
            className="self-start text-body"
            onClick={() => noteRef.current?.focus()}
          >
            Describe exactly what you want
          </TextLink>
        </div>
      ) : null}

      <section aria-label="Kind of problem" className="flex flex-col gap-2">
        <Caps as="h3">Kind of problem</Caps>
        <div role="radiogroup" aria-label="Kind of problem" className="grid grid-cols-2 gap-2">
          {SIDES.map((s) => (
            <ChoiceTile
              key={s.side}
              size="large"
              label={s.title}
              line={s.line}
              on={side === s.side}
              disabled={sending}
              onPick={() => {
                setError(null);
                setSide(s.side);
              }}
            />
          ))}
        </div>
      </section>

      {side ? (
        <div key={side} className="flex swap-in flex-col gap-5">
          {groups.map((group) => (
            <section
              key={group.id}
              aria-label={group.label ?? "What exactly"}
              className="flex flex-col gap-2"
            >
              <Caps as="h3">{group.label ?? "What exactly"}</Caps>
              <div role="group" className="grid grid-cols-2 gap-2 @sm:grid-cols-3">
                {group.options.map((option) => (
                  <CheckTile
                    key={option.code}
                    label={optionLabel(option)}
                    on={draft.picked.includes(option.code)}
                    disabled={sending}
                    onToggle={() => toggle(option.code)}
                  />
                ))}
              </div>
            </section>
          ))}
          {otherPicks.length > 0 ? (
            <p className="text-secondary text-label-2">
              Also sending: {otherPicks.map((o) => optionLabel(o)).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      {strips.length > 0 ? (
        <div className="overflow-hidden rounded-tile border border-outline-quiet bg-ground">
          {strips.map((option) => (
            <ReasonStrip
              key={option.code}
              option={option}
              draft={draft}
              frames={frames}
              disabled={sending}
              highlight={error?.code === option.code}
              onChange={change}
            />
          ))}
        </div>
      ) : null}

      <Field label={<Caps>Your note</Caps>} optional>
        <Textarea
          ref={noteRef}
          placeholder="What should the next image do differently?"
          value={draft.note}
          onChange={(e) => change({ ...draft, note: e.target.value })}
          minRows={2}
          maxRows={8}
          disabled={sending}
        />
      </Field>

      <MarkList marking={marking} subject="image" disabled={sending} />

      {asking ? (
        <ReferenceConflictChoice
          assetId={assetId}
          title="This goes against your photo"
          message={`${asking.conflict.changes.join(", ")} would change what your photo shows. Use a new photo, or drop it and make the change.`}
          photos={asking.conflict.references}
          designer={designer}
          sending={sending}
          onReplace={(fileId) => resolve(asking.conflict.references, { fileId })}
          onDrop={() => resolve(asking.conflict.references)}
        />
      ) : null}

      <div className="flex flex-col gap-4">
        <PriceLine price={price} balance={balance} action="image" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Button
            variant={given && !asking ? "primary" : "dark"}
            size="large"
            loading={sending}
            disabled={!affordable || asking !== null}
            onClick={submit}
          >
            Send Back
          </Button>
          <Button variant="plain" size="large" onClick={onCancel} disabled={sending}>
            Cancel
          </Button>
        </div>
        {reroll ? (
          <div className="flex flex-col items-start gap-1 border-t border-outline-quiet pt-4">
            <Button
              variant="plain"
              className="pl-0"
              disabled={sending || !affordable}
              onClick={() => onReroll(reroll.code)}
            >
              Try Again
            </Button>
            <p className="text-secondary text-pretty text-label-2">
              The same design drawn again, as a new variation. Nothing else changes.
            </p>
          </div>
        ) : null}
        <ErrorLine>{error?.text ?? serverError}</ErrorLine>
      </div>
    </div>
  );
}
