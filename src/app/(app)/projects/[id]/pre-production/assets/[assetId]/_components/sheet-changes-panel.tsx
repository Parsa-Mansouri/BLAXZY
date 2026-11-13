"use client";

import { useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { FixSelection } from "@/server/damis";
import type { ClientReviewOption } from "@/lib/review-option";
import { Button, Field, TextLink, Textarea, cn } from "@/ui";
import { MarkList } from "../../../_components/request-changes-panel";
import { focusSoon, markFieldId, type Marking } from "../../../_components/mark-layer";
import { firstBlankMark, foldMarks } from "../../../_lib/marks";
import { optionLabel, takesText } from "../_lib/look-review";
import {
  buildDesignChange,
  buildSheetSelections,
  designRouteOption,
  EMPTY_SHEET_DRAFT,
  hasSheetStrip,
  needsSheetAnswer,
  picksFrame,
  rerollOption,
  sheetChips,
  sheetOptionsFor,
  stepLabels,
  suggestedFirst,
  type DetailCell,
  type SheetCatalogInfo,
  type SheetChangesDraft,
} from "../_lib/sheet-review";
import { Caps, CheckTile, ChoiceTile } from "./desk";
import { PriceLine } from "./shared";
import { ErrorLine } from "@/app/(app)/_components/values";
import { canAfford, formatNumber } from "@/app/(app)/_lib/format";

type HeadingProps = { id?: string; className?: string; children: ReactNode };

type Side = "technical" | "preference" | "design";

export interface SheetChangesInput {
  selections: FixSelection[];
  note: string;
}

/** The words of the panel: a character sheet, or one view of a pack. */
export interface SheetChangesWords {
  /** "sheet" or "view", in sentences. */
  subject: string;
  /** The design tile: its title and the line under it. */
  designTile: { title: string; line: string };
  /** Under the design text box: what happens next. */
  designHint: string;
}

const PROBLEM_SIDES: readonly { side: Side; title: string; line: string }[] = [
  {
    side: "technical",
    title: "Something’s wrong",
    line: "Broken, cut off, mixed up or not what the design shows.",
  },
  {
    side: "preference",
    title: "I’d like it different",
    line: "It works, but you want another framing or detail.",
  },
];

/** The reasons of one side, in the catalog's groups when it has them. */
function groupedReasons(
  options: readonly ClientReviewOption[],
  groups: SheetCatalogInfo["groups"],
): { id: string; label: string | null; options: ClientReviewOption[] }[] {
  const grouped = new Map<string, ClientReviewOption[]>();
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

/** What one picked reason still needs: the numbered frame, a chip, the user's words. */
function ReasonStrip({
  option,
  draft,
  cells,
  disabled,
  highlight,
  onChange,
}: {
  option: ClientReviewOption;
  draft: SheetChangesDraft;
  cells: readonly DetailCell[];
  disabled: boolean;
  highlight: boolean;
  onChange: (next: SheetChangesDraft) => void;
}) {
  const id = useId();
  const code = option.code;
  const frame = picksFrame(option) && cells.length > 0;
  const chips = sheetChips(option);
  const text = takesText(option);
  const required = needsSheetAnswer(option);
  const labels = stepLabels(option);
  const chosenFrame = draft.frames[code];
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex flex-col gap-4 border-t border-outline-quiet p-4 first:border-t-0",
        highlight && "bg-red/5",
      )}
    >
      <Caps as="h3" id={`${id}-title`}>
        {optionLabel(option)}
      </Caps>
      {frame ? (
        <div className="flex flex-col gap-2">
          <p id={`${id}-frame`} className="text-secondary text-label-2">
            {labels.frame}
          </p>
          <div role="radiogroup" aria-labelledby={`${id}-frame`} className="grid grid-cols-2 gap-2">
            {cells.map((cell) => {
              const on = chosenFrame === cell.slot;
              return (
                <ChoiceTile
                  key={cell.slot}
                  label={
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono tabular-nums">{cell.slot}</span>
                      <span>{cell.subject}</span>
                    </span>
                  }
                  on={on}
                  disabled={disabled}
                  onPick={() => {
                    const frames = { ...draft.frames };
                    if (on) delete frames[code];
                    else frames[code] = cell.slot;
                    onChange({ ...draft, frames });
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}
      {/* A two-step follow-up asks its question once the frame is picked. */}
      {frame && chosenFrame === undefined ? null : (
        <>
          {chips.length > 0 ? (
            <div className="flex flex-col gap-2">
              {frame ? (
                <p id={`${id}-answer`} className="text-secondary text-label-2">
                  {labels.answer}
                </p>
              ) : null}
              <div
                role="radiogroup"
                aria-labelledby={frame ? `${id}-answer` : `${id}-title`}
                className="grid grid-cols-2 gap-2"
              >
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
        </>
      )}
    </section>
  );
}

/**
 * "What should change?" for a sheet maker's image (a character sheet, or one view of a location
 * pack or prop sheet), in place of the decision: the kind of problem as large tiles (a third one
 * goes back to the design step), the catalog's reasons in its groups as square tiles, and under
 * each picked reason what it still needs (the numbered detail frame, a chip, the user's words). A
 * reason the catalog calls a random glitch first offers to make it again. A free note and marks on
 * the picture go with the picks; "Make It Again" re-rolls on its own.
 */
export function SheetChangesPanel({
  catalog,
  cells,
  words,
  initialDesignText = null,
  rejectedInARow,
  maxNote,
  sending,
  serverError,
  price,
  priceAction,
  balance,
  marking,
  markSubject,
  onSubmit,
  onReroll,
  onCancel,
  headingAs: Heading,
}: {
  catalog: SheetCatalogInfo;
  /** The character sheet's numbered detail frames (none for a pack's view). */
  cells: readonly DetailCell[];
  words: SheetChangesWords;
  /** Opens on the design change, with these words written (a refused design change). */
  initialDesignText?: string | null;
  rejectedInARow: number;
  maxNote: number;
  sending: boolean;
  serverError: string | null;
  price: number | null;
  priceAction: "sheet" | "view";
  balance: number;
  marking: Marking;
  markSubject: "image" | "sheet";
  onSubmit: (input: SheetChangesInput) => void;
  onReroll: (code: string) => void;
  onCancel: () => void;
  headingAs: ComponentType<HeadingProps>;
}) {
  const id = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const { options } = catalog;
  const route = designRouteOption(options);
  const reroll = rerollOption(options);
  const [side, setSide] = useState<Side | null>(
    initialDesignText !== null && route ? "design" : null,
  );
  const [draft, setDraft] = useState<SheetChangesDraft>({
    ...EMPTY_SHEET_DRAFT,
    designText: initialDesignText ?? "",
  });
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const marks = marking.marks;
  const affordable = canAfford(price, balance);
  const tried = rejectedInARow >= catalog.maxAttempts && catalog.attemptMessage !== null;
  const designing = side === "design";

  const picked = draft.picked
    .map((code) => options.find((o) => o.code === code))
    .filter((o): o is ClientReviewOption => o !== undefined);
  const strips = picked.filter((o) => hasSheetStrip(o));
  const otherPicks = picked.filter((o) => side !== null && side !== "design" && o.kind !== side);
  const suggestion = designing ? null : suggestedFirst(draft.picked, options);
  const given = designing
    ? draft.designText.trim().length > 0
    : picked.length > 0 || draft.note.trim().length > 0 || marks.length > 0;

  const sides = route
    ? [...PROBLEM_SIDES, { side: "design" as const, ...words.designTile }]
    : PROBLEM_SIDES;

  function change(next: SheetChangesDraft) {
    setError(null);
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

  function submitDesign() {
    const built = buildDesignChange(route, draft.designText, maxNote);
    if (!built.ok) {
      setError({ text: built.error, code: built.code });
      return;
    }
    onSubmit({ selections: built.selections, note: "" });
  }

  function submit() {
    if (designing) {
      submitDesign();
      return;
    }
    if (!given) {
      setError({ text: `Pick what is wrong, write a note or mark the ${words.subject}.` });
      return;
    }
    const built = buildSheetSelections(draft, options, cells, maxNote);
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
    const note = foldMarks(draft.note, marks, markSubject);
    if (note.length > maxNote) {
      setError({
        text:
          marks.length > 0
            ? `Keep the note and the marks under ${formatNumber(maxNote)} characters together.`
            : `Keep the note under ${formatNumber(maxNote)} characters.`,
      });
      return;
    }
    onSubmit({ selections: built.selections, note });
  }

  const reasons = side && side !== "design" ? sheetOptionsFor(options, side) : [];
  const groups = groupedReasons(reasons, catalog.groups);

  return (
    <div className="@container flex min-w-0 flex-col gap-7">
      <Heading id={`${id}-title`} className="text-heading-sm text-balance">
        What should change?
      </Heading>

      {tried ? (
        <div className="flex flex-col gap-2 border-l-2 border-brand pl-4">
          <p className="text-body text-pretty text-label">{catalog.attemptMessage}</p>
          {route ? (
            <TextLink
              render={<button type="button" disabled={sending} />}
              className="self-start text-body"
              onClick={() => {
                setError(null);
                setSide("design");
              }}
            >
              {words.designTile.title}
            </TextLink>
          ) : (
            <TextLink
              render={<button type="button" disabled={sending} />}
              className="self-start text-body"
              onClick={() => noteRef.current?.focus()}
            >
              Describe exactly what you want
            </TextLink>
          )}
        </div>
      ) : null}

      <section aria-label="Kind of problem" className="flex flex-col gap-2">
        <Caps as="h3">Kind of problem</Caps>
        <div
          role="radiogroup"
          aria-label="Kind of problem"
          className={cn("grid grid-cols-2 gap-2", sides.length === 3 && "@lg:grid-cols-3")}
        >
          {sides.map((s) => (
            <ChoiceTile
              key={s.side}
              size="large"
              label={s.title}
              line={s.line}
              on={side === s.side}
              disabled={sending}
              className={s.side === "design" ? "col-span-2 @lg:col-span-1" : undefined}
              onPick={() => {
                setError(null);
                setSide(s.side);
              }}
            />
          ))}
        </div>
      </section>

      {designing ? (
        <div key="design" className="flex swap-in flex-col gap-3">
          {catalog.designChangeMessage ? (
            <p className="text-secondary text-pretty text-label-2">{catalog.designChangeMessage}</p>
          ) : null}
          <Field label={<Caps>What should change in the design?</Caps>}>
            <Textarea
              value={draft.designText}
              onChange={(e) => change({ ...draft, designText: e.target.value })}
              minRows={2}
              maxRows={8}
              disabled={sending}
            />
          </Field>
          <p className="text-secondary text-pretty text-label-2">{words.designHint}</p>
        </div>
      ) : side ? (
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

      {!designing && strips.length > 0 ? (
        <div className="overflow-hidden rounded-tile border border-outline-quiet bg-ground">
          {strips.map((option) => (
            <ReasonStrip
              key={option.code}
              option={option}
              draft={draft}
              cells={cells}
              disabled={sending}
              highlight={error?.code === option.code}
              onChange={change}
            />
          ))}
        </div>
      ) : null}

      {suggestion ? (
        <div className="flex flex-col items-start gap-2 rounded-tile border border-outline-quiet bg-elevated p-4">
          <p className="text-body text-pretty text-label">
            {suggestion.for.join(", ")}: this is usually a random glitch.
          </p>
          <p className="text-secondary text-pretty text-label-2">
            Making the {words.subject} again with the same instructions often fixes it, and nothing
            else changes.
          </p>
          <Button
            variant="outlined"
            disabled={sending || !affordable}
            onClick={() => onReroll(suggestion.option.code)}
          >
            Make It Again
          </Button>
        </div>
      ) : null}

      {designing ? null : (
        <>
          <Field label={<Caps>Your note</Caps>} optional>
            <Textarea
              ref={noteRef}
              placeholder={`What should the next ${words.subject} do differently?`}
              value={draft.note}
              onChange={(e) => change({ ...draft, note: e.target.value })}
              minRows={2}
              maxRows={8}
              disabled={sending}
            />
          </Field>
          <MarkList marking={marking} subject={markSubject} disabled={sending} />
        </>
      )}

      <div className="flex flex-col gap-4">
        {designing ? null : <PriceLine price={price} balance={balance} action={priceAction} />}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Button
            variant={given ? "primary" : "dark"}
            size="large"
            loading={sending}
            disabled={!designing && !affordable}
            onClick={submit}
          >
            {designing ? "Change the Design" : "Send Back"}
          </Button>
          <Button variant="plain" size="large" onClick={onCancel} disabled={sending}>
            Cancel
          </Button>
        </div>
        {reroll && !designing && !suggestion ? (
          <div className="flex flex-col items-start gap-1 border-t border-outline-quiet pt-4">
            <Button
              variant="plain"
              className="pl-0"
              disabled={sending || !affordable}
              onClick={() => onReroll(reroll.code)}
            >
              Make It Again
            </Button>
            <p className="text-secondary text-pretty text-label-2">
              For a random glitch: the same instructions drawn again as a new variation. Nothing
              else changes.
            </p>
          </div>
        ) : null}
        <ErrorLine>{error?.text ?? serverError}</ErrorLine>
      </div>
    </div>
  );
}
