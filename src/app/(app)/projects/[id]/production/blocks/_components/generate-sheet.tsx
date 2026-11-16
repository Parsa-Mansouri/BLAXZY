"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/ui";
import { useSpend } from "@/app/(app)/_components/spend-confirm";
import { Credits } from "@/app/(app)/_components/values";
import { shotsWords } from "../../_components/format";
import { clipsHref } from "../../../_lib/production-routes";
import { startDraftsAction } from "../actions";

/**
 * Starts the drafts: the price is read, the user confirms it (unless they turned the question
 * off), then every approved shot gets a draft. Renders nothing; it runs once when mounted and
 * calls `onClose` when it is over (done, cancelled or failed). If the price changed by the time
 * of the confirmation the new price is shown instead.
 */
export function GenerateDrafts({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const router = useRouter();
  const spend = useSpend();
  const toast = useToast();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const result = await spend.run({
        target: { kind: "drafts", projectId },
        title: "Generate drafts?",
        description: (quote) =>
          quote.drafts ? (
            <>
              A draft is a quick, lower-quality version of a shot, for{" "}
              <span className="tabular-nums">{shotsWords(quote.drafts.count)}</span>. Each shot you
              accept is then finished in full quality for <Credits n={quote.drafts.finalsEach} />.
            </>
          ) : undefined,
        confirmLabel: "Generate drafts",
        submit: (expectedCredits) => startDraftsAction(projectId, expectedCredits),
      });
      if (result && !result.ok) {
        toast.danger("The drafts were not started", result.error);
      } else if (result?.ok) {
        router.push(clipsHref(projectId));
      }
      onClose();
    })();
  }, [spend, projectId, router, toast, onClose]);

  return null;
}
