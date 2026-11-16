"use client";

import { ChangeRequestBox, Sheet } from "@/ui";

/** The longest change request, in characters (the server's limit). */
const MAX_NOTE_CHARS = 2000;

/**
 * "Request Changes" on a script: one box to explain what should be different, in the user's own
 * words. Comments made on the script itself travel with it, so a note is optional when there are
 * some.
 */
export function RequestChangesSheet({
  open,
  onOpenChange,
  commentCount,
  sending,
  serverError,
  onSubmit,
  initialNote = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commentCount: number;
  sending: boolean;
  serverError: string | null;
  onSubmit: (input: { note: string }) => void;
  /** Prefilled note (rejecting one of the writer's assumptions). */
  initialNote?: string;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Request Changes"
      description="Tell the next version what to change. It comes back revised for another review."
    >
      <ChangeRequestBox
        maxLength={MAX_NOTE_CHARS}
        placeholder="The ending feels rushed. Let Maya say goodbye to her brother before she leaves, and cut the second chase."
        submitLabel="Request Changes"
        initialNote={initialNote}
        allowEmpty={commentCount > 0}
        sending={sending}
        serverError={serverError}
        onSubmit={(note) => onSubmit({ note })}
        onCancel={() => onOpenChange(false)}
      >
        {commentCount > 0 ? (
          <p className="text-secondary text-label-2 tabular-nums">
            {`+ your ${commentCount} line comment${commentCount === 1 ? "" : "s"}`}
          </p>
        ) : null}
      </ChangeRequestBox>
    </Sheet>
  );
}
