"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { BlockSwapScene, ChangeRequestBox, DemoHint } from "@/ui";

/**
 * "What should change?": one box to explain it in the user's own words. It replaces the decision
 * buttons in place (no modal), and is mounted only while open, so it starts empty. The heading
 * takes focus when it appears.
 */
export function ChangeRequest({
  maxNote,
  sending,
  serverError,
  onSubmit,
  secondaryAction,
  onCancel,
  notePlaceholder,
  cost,
  blocked = false,
}: {
  maxNote: number;
  sending: boolean;
  serverError: string | null;
  onSubmit: (input: { note: string }) => void;
  /** A second send beside "Send Back" (a note is optional for it). */
  secondaryAction?: { label: string; onSelect: (note: string) => void };
  onCancel: () => void;
  notePlaceholder: string;
  /** A plain line about the price, under the note. */
  cost?: ReactNode;
  /** Sending is not possible (for example, not enough credits). */
  blocked?: boolean;
}) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="flex swap-in flex-col gap-6">
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
      <ChangeRequestBox
        autoFocus={false}
        maxLength={maxNote}
        placeholder={notePlaceholder}
        sending={sending}
        serverError={serverError}
        blocked={blocked}
        submitLabel="Send Back"
        onSubmit={(note) => onSubmit({ note })}
        secondaryAction={secondaryAction}
        onCancel={onCancel}
      >
        {cost}
      </ChangeRequestBox>
    </div>
  );
}
