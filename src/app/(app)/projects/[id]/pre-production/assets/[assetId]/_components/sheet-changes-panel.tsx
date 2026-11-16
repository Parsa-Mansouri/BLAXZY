"use client";

import { useId, useState, type ComponentType, type ReactNode } from "react";
import { Button, ChangeRequestBox } from "@/ui";
import { markedNote } from "../../../_lib/marks";
import { MarkList } from "../../../_components/mark-list";
import { focusSoon, markFieldId, type Marking } from "../../../_components/mark-layer";
import type { SheetCatalogInfo } from "../_lib/sheet-review";
import { PriceLine } from "./shared";
import { canAfford } from "@/app/(app)/_lib/format";

type HeadingProps = { id?: string; className?: string; children: ReactNode };

export interface SheetChangesInput {
  /** What should change, in the user's own words (the marks folded in). */
  note: string;
  /** The words are a change of the approved design, made by the designer. */
  designChange: boolean;
}

/** The words of the panel: a character sheet, or one view of a pack. */
export interface SheetChangesWords {
  /** "sheet" or "view", in sentences. */
  subject: string;
  /** A concrete example of what to write. */
  placeholder: string;
  /** Under the design text box: what happens next. */
  designHint: string;
}

/**
 * "What should change?" for a sheet or a pack view, in place of the decision it replaces (no
 * modal): one box for the user's own words, marks on the picture, the price of the new one, and
 * Make It Again (the same instructions drawn again, no words needed). A change of the design the
 * sheet maker refused opens it on the design step instead (`initialDesignText`): the words go
 * back to the designer. Mounted only while open.
 */
export function SheetChangesPanel({
  catalog,
  words,
  initialDesignText,
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
  onReroll: () => void;
  onCancel: () => void;
  headingAs: ComponentType<HeadingProps>;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const designing = initialDesignText !== null && initialDesignText !== undefined;
  const marks = marking.marks;
  const affordable = canAfford(price, balance);
  const tried = rejectedInARow >= catalog.maxAttempts && catalog.attemptMessage !== null;

  function submit(note: string) {
    if (designing) {
      onSubmit({ note, designChange: true });
      return;
    }
    const built = markedNote(note, marks, markSubject, maxNote);
    if (!built.ok) {
      setError(built.error);
      const blankMark = built.blank === undefined ? undefined : marks[built.blank - 1];
      if (blankMark) focusSoon(markFieldId(blankMark.id));
      return;
    }
    setError(null);
    onSubmit({ note: built.note, designChange: false });
  }

  return (
    <div className="@container flex min-w-0 flex-col gap-7">
      <Heading id={`${id}-title`} className="text-heading-sm text-balance">
        {designing ? "Change the design" : "What should change?"}
      </Heading>

      {tried && !designing ? (
        <p className="border-l-2 border-brand pl-4 text-body text-pretty text-label">
          {catalog.attemptMessage}
        </p>
      ) : null}

      {designing && catalog.designChangeMessage ? (
        <p className="text-secondary text-pretty text-label-2">{catalog.designChangeMessage}</p>
      ) : null}

      <ChangeRequestBox
        key={designing ? "design" : "changes"}
        maxLength={maxNote}
        label={designing ? "What should change in the design?" : "Tell us what to change"}
        placeholder={designing ? "Make the coat red." : words.placeholder}
        initialNote={designing ? initialDesignText : ""}
        submitLabel={designing ? "Change the Design" : "Send Back"}
        sending={sending}
        serverError={error ?? serverError}
        blocked={!designing && !affordable}
        allowEmpty={!designing && marks.length > 0}
        onEdit={() => setError(null)}
        onSubmit={submit}
        onCancel={onCancel}
      >
        {designing ? (
          <p className="text-secondary text-pretty text-label-2">{words.designHint}</p>
        ) : (
          <>
            <MarkList marking={marking} subject={markSubject} disabled={sending} />
            <PriceLine price={price} balance={balance} action={priceAction} />
          </>
        )}
      </ChangeRequestBox>

      {designing ? null : (
        <div className="flex flex-col items-start gap-1 border-t border-outline-quiet pt-4">
          <Button
            variant="plain"
            className="pl-0"
            disabled={sending || !affordable}
            onClick={onReroll}
          >
            Make It Again
          </Button>
          <p className="text-secondary text-pretty text-label-2">
            For a random glitch: the same instructions drawn again as a new variation. Nothing else
            changes.
          </p>
        </div>
      )}
    </div>
  );
}
