"use client";

import { useState, useTransition } from "react";
import { useSpend } from "@/app/(app)/_components/spend-confirm";
import { ErrorLine } from "@/app/(app)/_components/values";
import { Button } from "@/ui";
import { updateShotAction } from "../blocks/actions";

/**
 * "The shot before now ends differently." with "Update This Shot": a notice, not a block. The
 * update revises the shot to open from the new ending, whatever state it is in; with clips it
 * makes a new draft, so the price of one draft is confirmed first.
 */
export function HandoffNotice({
  projectId,
  lineageId,
  onDone,
}: {
  projectId: string;
  lineageId: string;
  onDone: () => void;
}) {
  const spend = useSpend();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update() {
    setError(null);
    startTransition(async () => {
      const result = await spend.run({
        target: { kind: "shot_update", lineageId, of: "self" },
        title: "Update this shot?",
        description:
          "The shot is rewritten to open from the new ending of the shot before it. If it has clips, a new draft is made.",
        confirmLabel: "Update This Shot",
        submit: (expectedCredits) => updateShotAction(projectId, lineageId, expectedCredits),
      });
      if (result === null) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div
      role="note"
      className="flex max-w-(--measure) flex-col items-start gap-3 rounded-card bg-elevated p-5"
    >
      <p className="text-body text-pretty text-label">The shot before now ends differently.</p>
      <p className="text-secondary text-pretty text-label-2">
        This shot still opens from the old ending. You can keep it as it is or update it.
      </p>
      <Button loading={pending} onClick={update}>
        Update This Shot
      </Button>
      <ErrorLine className="text-failed">{error}</ErrorLine>
    </div>
  );
}
