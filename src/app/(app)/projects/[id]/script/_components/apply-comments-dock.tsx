"use client";

import { Button } from "@/ui";

/**
 * A capsule fixed at the bottom-centre of the viewport that applies the user's line comments
 * without opening the Request Changes sheet. Render it only when there is something to send.
 * The outer strip ignores pointer events so it never blocks the page beside the capsule.
 */
export function ApplyCommentsDock({
  count,
  applying,
  disabled,
  error,
  onApply,
}: {
  count: number;
  applying: boolean;
  /** Another action (accept, request changes) is running. */
  disabled: boolean;
  error: string | null;
  onApply: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex max-w-full swap-in flex-col items-center gap-2">
        {error ? (
          <p
            role="alert"
            className="rounded-tile border border-outline bg-elevated px-3 py-2 text-center text-secondary text-red shadow-float"
          >
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-4 rounded-capsule border border-outline bg-elevated-2 py-2 pr-2 pl-5 shadow-float">
          <p className="text-body text-label tabular-nums">
            {count} {count === 1 ? "comment" : "comments"}
          </p>
          <Button variant="primary" onClick={onApply} loading={applying} disabled={disabled}>
            Apply Comments
          </Button>
        </div>
      </div>
    </div>
  );
}
