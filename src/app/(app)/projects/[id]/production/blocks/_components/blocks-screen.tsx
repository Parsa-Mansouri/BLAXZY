"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, ProgressBar } from "@/ui";
import { usePolling } from "../../../_lib/use-polling";
import { blockHref, phaseHref } from "../../../_lib/production-routes";
import {
  approveAllAction,
  loadBlocksAction,
  refreshBlocksAction,
  type BlocksSnapshot,
} from "../actions";
import { attentionWords, needsReview } from "../_lib/block-state";
import { BlockRow } from "./block-row";
import { GenerateSheet } from "./generate-sheet";

const FAST_POLL_MS = 2000;
const SETTLED_POLL_MS = 10000;

/** The shots of the film in story order: review them, approve them, then generate the drafts. */
export function BlocksScreen({
  projectId,
  initial,
}: {
  projectId: string;
  initial: BlocksSnapshot;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, startApproving] = useTransition();
  const [approveError, setApproveError] = useState<string | undefined>();
  const [generateOpen, setGenerateOpen] = useState(false);
  const busyRef = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const { items, nextCursor, counts } = snapshot;
  const preparing = counts.preparing > 0;
  const reviewable = counts.block_review + counts.prepare_failed;

  /** Takes a fresh snapshot; leaves the screen when the shots moved on to clips. */
  function adopt(next: BlocksSnapshot) {
    if (next.phase === "generating" || next.phase === "finished") {
      router.push(phaseHref(projectId, next.phase));
      return;
    }
    setSnapshot(next);
  }

  usePolling(
    async (isActive) => {
      if (busyRef.current) return;
      const result = await refreshBlocksAction(projectId, items.length);
      if (!isActive() || busyRef.current || !result.ok) return;
      adopt(result.data);
    },
    true,
    preparing ? FAST_POLL_MS : SETTLED_POLL_MS,
  );

  function more() {
    if (!nextCursor) return;
    setError(null);
    busyRef.current = true;
    startLoading(async () => {
      try {
        const result = await loadBlocksAction(projectId, nextCursor);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSnapshot((current) => ({
          ...result.data,
          items: [...current.items, ...result.data.items],
        }));
      } finally {
        busyRef.current = false;
      }
    });
  }

  function approveAll() {
    setApproveError(undefined);
    busyRef.current = true;
    startApproving(async () => {
      try {
        const result = await approveAllAction(projectId, items.length);
        if (!result.ok) {
          setApproveError(result.error);
          return;
        }
        setApproveOpen(false);
        adopt(result.data);
        // The status line now reads "All shots are approved."; move there for screen readers.
        window.setTimeout(() => statusRef.current?.focus(), 0);
      } finally {
        busyRef.current = false;
      }
    });
  }

  const firstToReview = items.find((b) => needsReview(b.stage));
  const status = attentionWords(counts);
  const allPreparing = items.length > 0 && items.every((b) => b.stage === "preparing");

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="text-large-title">Shots</h2>
          <p
            ref={statusRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            className="text-reading text-label-2 outline-none"
          >
            {allPreparing
              ? "Preparing the shots…"
              : status || "Each shot is checked before its clip is made."}
          </p>
        </div>
        {!allPreparing && items.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {counts.block_review > 0 ? (
              <Button onClick={() => setApproveOpen(true)}>Approve All</Button>
            ) : null}
            {reviewable > 0 ? (
              firstToReview ? (
                <Button
                  variant="prominent"
                  size="large"
                  render={<Link href={blockHref(projectId, firstToReview.lineageId)} />}
                >
                  Review Next Shot
                </Button>
              ) : nextCursor ? (
                <Button variant="prominent" size="large" onClick={more} loading={loading}>
                  Review Next Shot
                </Button>
              ) : null
            ) : snapshot.canStartDrafts ? (
              <Button variant="prominent" size="large" onClick={() => setGenerateOpen(true)}>
                Generate Drafts
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      {allPreparing ? (
        <div className="flex max-w-sm flex-col gap-2.5">
          <ProgressBar value={null} aria-label="Preparing the shots" />
          <p className="text-callout text-label-2">
            You can leave this page. The shots are ready to review when you return.
          </p>
        </div>
      ) : items.length === 0 ? (
        <p className="max-w-(--measure) text-reading text-label-2">
          There are no shots yet. They appear here once the script has been cut into shots.
        </p>
      ) : (
        <section aria-label="Shots" className="flex flex-col gap-4">
          <ol className="flex flex-col">
            {items.map((block) => (
              <BlockRow key={block.lineageId} projectId={projectId} block={block} />
            ))}
          </ol>
          {nextCursor ? (
            <div>
              <Button onClick={more} loading={loading}>
                Load More
              </Button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-callout text-red">
              {error}
            </p>
          ) : null}
        </section>
      )}

      <Alert
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve All Shots?"
        message="Every shot that waits for review is approved as prepared. Shots that need attention stay as they are, and you can still change any shot before the drafts are made."
        confirmLabel="Approve All"
        destructive={false}
        onConfirm={approveAll}
        loading={approving}
        error={approveError}
      />
      {generateOpen ? (
        <GenerateSheet open onOpenChange={setGenerateOpen} projectId={projectId} />
      ) : null}
    </div>
  );
}
