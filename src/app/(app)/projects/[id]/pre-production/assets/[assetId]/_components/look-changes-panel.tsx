"use client";

import { useId, useState, type ComponentType, type ReactNode } from "react";
import { Button, ChangeRequestBox } from "@/ui";
import { markedNote } from "../../../_lib/marks";
import { MarkList } from "../../../_components/mark-list";
import { focusSoon, markFieldId, type Marking } from "../../../_components/mark-layer";
import type { DesignerInfo } from "../_lib/designer-view";
import { PriceLine } from "./shared";
import { canAfford } from "@/app/(app)/_lib/format";

type HeadingProps = { id?: string; className?: string; children: ReactNode };

/** A concrete example of what to write, for each kind of asset. */
const PLACEHOLDERS: Record<DesignerInfo["key"], string> = {
  character: "Make her coat dark green instead of black, and keep the same face.",
  location: "Make the room emptier, lit only by the window on the left.",
  prop: "The handle should be brass, not silver, and the lid a little smaller.",
};

export interface LookChangesInput {
  /** What should change, in the user's own words (the marks on the image folded in). */
  note: string;
}

/**
 * "What should change?" for a look, in place of the decision it replaces (no modal): one box for
 * the user's own words, marks on the image, the price of the new image, and Try Again (the same
 * design drawn again, no words needed). Mounted only while open.
 */
export function LookChangesPanel({
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
  designer: Pick<DesignerInfo, "key" | "maxAttempts" | "attemptMessage">;
  rejectedInARow: number;
  maxNote: number;
  sending: boolean;
  serverError: string | null;
  price: number | null;
  balance: number;
  marking: Marking;
  onSubmit: (input: LookChangesInput) => void;
  onReroll: () => void;
  onCancel: () => void;
  headingAs: ComponentType<HeadingProps>;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const marks = marking.marks;
  const affordable = canAfford(price, balance);
  const tried = rejectedInARow >= designer.maxAttempts;

  function submit(note: string) {
    const built = markedNote(note, marks, "image", maxNote);
    if (!built.ok) {
      setError(built.error);
      const blankMark = built.blank === undefined ? undefined : marks[built.blank - 1];
      if (blankMark) focusSoon(markFieldId(blankMark.id));
      return;
    }
    setError(null);
    onSubmit({ note: built.note });
  }

  return (
    <div className="@container flex min-w-0 flex-col gap-7">
      <Heading id={`${id}-title`} className="text-heading-sm text-balance">
        What should change?
      </Heading>

      {tried ? (
        <p className="border-l-2 border-brand pl-4 text-body text-pretty text-label">
          {designer.attemptMessage ??
            "We have tried a few times and it is still not right. A precise description usually settles it."}
        </p>
      ) : null}

      <ChangeRequestBox
        maxLength={maxNote}
        placeholder={PLACEHOLDERS[designer.key]}
        submitLabel="Send Back"
        sending={sending}
        serverError={error ?? serverError}
        blocked={!affordable}
        allowEmpty={marks.length > 0}
        onEdit={() => setError(null)}
        onSubmit={submit}
        onCancel={onCancel}
      >
        <MarkList marking={marking} subject="image" disabled={sending} />
        <PriceLine price={price} balance={balance} action="image" />
      </ChangeRequestBox>

      <div className="flex flex-col items-start gap-1 border-t border-outline-quiet pt-4">
        <Button
          variant="plain"
          className="pl-0"
          disabled={sending || !affordable}
          onClick={onReroll}
        >
          Try Again
        </Button>
        <p className="text-secondary text-pretty text-label-2">
          The same design drawn again, as a new variation. Nothing else changes.
        </p>
      </div>
    </div>
  );
}
