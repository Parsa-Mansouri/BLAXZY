"use client";

import { useState, useTransition } from "react";
import { Button, ChangeRequestBox, Sheet } from "@/ui";
import { submitDetectionReviewAction } from "../actions";

/**
 * "Something wrong with this list?": one box to say what is off, in the user's own words (the
 * list is corrected in the background and comes back here). Re-scanning the whole script is the
 * quiet way out, an action that needs no words.
 */
export function DetectionReviewSheet({
  open,
  onOpenChange,
  projectId,
  initialNote,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Words to start from (a card's menu or a warning). */
  initialNote: string;
  onSent: (result: { started: boolean }) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [rescanning, startRescan] = useTransition();
  const busy = sending || rescanning;

  function send(note: string) {
    setError(null);
    startSending(async () => {
      const result = await submitDetectionReviewAction(projectId, { note });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSent(result.data);
    });
  }

  function rescan() {
    setError(null);
    startRescan(async () => {
      const result = await submitDetectionReviewAction(projectId, { rescan: true });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSent(result.data);
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      size="lg"
      title="Something Wrong With This List?"
      description="Say what is off. The list is corrected in the background and comes back here."
    >
      <div className="flex flex-col gap-6">
        <ChangeRequestBox
          initialNote={initialNote}
          placeholder="Mara and Marla are the same woman, and the old lighthouse is missing from the locations."
          submitLabel="Send"
          sending={sending}
          serverError={error}
          onSubmit={send}
          onCancel={() => onOpenChange(false)}
        />
        <div className="flex flex-col items-start gap-1 border-t border-outline-quiet pt-4">
          <Button
            variant="plain"
            className="pl-0"
            onClick={rescan}
            loading={rescanning}
            disabled={sending}
          >
            Re-scan the Whole Script
          </Button>
          <p className="text-secondary text-pretty text-label-2">
            The script is read again from the start. Assets you already approved keep their place.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
