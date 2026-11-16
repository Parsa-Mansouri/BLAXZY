"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  FeatureBlock,
  PageHeader,
  ProgressBar,
  QuietTile,
  StatusLine,
  cn,
  stagger,
} from "@/ui";
import { useServerSnapshot } from "@/app/(app)/_lib/use-server-snapshot";
import { refreshBlocks } from "@/app/(app)/_lib/poll-client";
import { FAST_POLL_MS, SETTLED_POLL_MS, usePolling } from "@/app/(app)/_lib/use-polling";
import { blockHref, phaseHref } from "../../../_lib/production-routes";
import { approveAllAction, loadBlocksAction, type BlocksSnapshot } from "../actions";
import { takeArrival } from "../_lib/arrival";
import { mergeBlocksSnapshot } from "../_lib/merge-snapshot";
import { attentionTone, attentionWords, needsReview } from "../_lib/block-state";
import { BlockRow, PendingBlockRow } from "./block-row";
import { useChangedKeys } from "../../_components/feedback";
import { GenerateDrafts } from "./generate-sheet";
import { FillPage } from "../../_components/fill-page";

/**
 * The shots of the film in story order. The one next step leads as a white block (review the
 * next shot, or generate the drafts), Approve All stays beside it as the quieter road, and every
 * shot is listed below to open in any order.
 */
export function BlocksScreen({
  projectId,
  initial,
}: {
  projectId: string;
  initial: BlocksSnapshot;
}) {
  const router = useRouter();
  // A fresh server render (a refresh, coming back to the list) updates the local copy, so the
  // status line says where the shots stand now; shots loaded further down stay.
  const [snapshot, setSnapshot] = useServerSnapshot(initial, mergeBlocksSnapshot);
  const statusRef = useRef<HTMLDivElement>(null);
  // Arriving from Approve on the last shot to review: focus starts at the status line under the
  // title (the page heading itself is not focusable).
  useEffect(() => {
    if (takeArrival()) statusRef.current?.focus({ preventScroll: true });
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, startApproving] = useTransition();
  const [approveError, setApproveError] = useState<string | undefined>();
  const [generateOpen, setGenerateOpen] = useState(false);
  const busyRef = useRef(false);

  const { items, nextCursor, counts } = snapshot;
  const changed = useChangedKeys(items.map((b) => [b.lineageId, b.stage] as const));
  const preparing = counts.preparing > 0;
  const reviewable = counts.block_review + counts.prepare_failed;

  /** Takes a fresh snapshot; leaves the screen when the shots moved on to clips. */
  function adopt(next: BlocksSnapshot) {
    if (next.phase === "generating" || next.phase === "finished") {
      router.push(phaseHref(projectId, next.phase, next.projectStage));
      return;
    }
    setSnapshot(next);
  }

  usePolling(
    async (isActive, signal) => {
      if (busyRef.current) return;
      const result = await refreshBlocks(projectId, items.length, { signal });
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
        // The status line now says every shot is approved; move there for screen readers.
        window.setTimeout(() => statusRef.current?.focus(), 0);
      } finally {
        busyRef.current = false;
      }
    });
  }

  const firstToReview = items.find((b) => needsReview(b.stage));
  const allPreparing = items.length > 0 && items.every((b) => b.stage === "preparing");
  const words = allPreparing ? "Preparing the shots" : attentionWords(counts);
  const tone = allPreparing ? "working" : attentionTone(counts);

  function nextStep() {
    if (allPreparing) {
      return (
        <section
          aria-label="Preparing the shots"
          className="flex min-h-75 flex-1 flex-col justify-between gap-10 rounded-block bg-elevated p-6 sm:p-10"
        >
          <h2 className="max-w-[22ch] text-heading text-balance">The shots are being prepared.</h2>
          <div className="flex max-w-sm flex-col gap-3">
            <ProgressBar value={null} aria-label="Preparing the shots" />
            <p className="text-body text-pretty text-label-2">
              You can leave this page. The shots are ready to review when you return.
            </p>
          </div>
        </section>
      );
    }
    if (items.length === 0) {
      return (
        <div className="flex flex-col gap-2">
          <h2 className="text-section text-balance">No shots yet</h2>
          <p className="max-w-(--measure) text-body text-pretty text-label-2">
            They appear here once the script has been cut into shots.
          </p>
        </div>
      );
    }

    let lead: ReactNode = null;
    if (reviewable > 0 && firstToReview) {
      const number = firstToReview.orderIndex + 1;
      lead = (
        <FeatureBlock
          className="flex-[2_1_320px]"
          render={<Link href={blockHref(projectId, firstToReview.lineageId)} />}
          title="Review Next Shot"
          description={`${number} · ${firstToReview.title ?? `Shot ${number}`}`}
          cta="Review"
        />
      );
    } else if (reviewable > 0 && nextCursor) {
      lead = (
        <FeatureBlock
          className="flex-[2_1_320px]"
          title="Review Next Shot"
          cta={loading ? "Loading…" : "Review"}
          disabled={loading}
          onClick={more}
        />
      );
    } else if (reviewable === 0 && snapshot.canStartDrafts) {
      lead = (
        <FeatureBlock
          className="flex-[2_1_320px]"
          title="Generate Drafts"
          description="A quick, lower-quality version of each shot, to check the action and framing before the full-quality clip."
          cta="Start the Drafts"
          onClick={() => setGenerateOpen(true)}
        />
      );
    }
    if (!lead && counts.block_review === 0) return null;

    return (
      <div className="flex flex-1 flex-wrap gap-3">
        {lead}
        {counts.block_review > 0 ? (
          <div className={cn("flex flex-col gap-3", lead ? "flex-[1_1_220px]" : "w-full max-w-90")}>
            <QuietTile
              className="flex-1"
              title="Approve All"
              description="Every shot waiting for review is approved as prepared."
              onClick={() => setApproveOpen(true)}
            />
          </div>
        ) : null}
      </div>
    );
  }

  const step = nextStep();
  const grow = step !== null && (allPreparing || items.length > 0);

  return (
    <FillPage>
      <PageHeader
        title="Shots"
        description={
          words ? (
            <div
              ref={statusRef}
              tabIndex={-1}
              role="status"
              aria-live="polite"
              className="outline-none"
            >
              <StatusLine tone={tone}>{words}</StatusLine>
            </div>
          ) : undefined
        }
      />

      <div className={cn("flex in-2 flex-col", grow && "flex-1")}>{step}</div>

      {!allPreparing && items.length > 0 ? (
        <section aria-label="Every shot" className="mt-12 flex in-3 flex-col gap-4">
          <ol className="flex flex-col gap-0.5">
            {items.map((block, i) => (
              <BlockRow
                key={block.lineageId}
                projectId={projectId}
                block={block}
                settle={changed.has(block.lineageId)}
                className="enter"
                style={stagger(Math.min(i, 12))}
              />
            ))}
            {loading ? <PendingBlockRow /> : null}
          </ol>
          {nextCursor ? (
            <div>
              <Button size="small" onClick={more} loading={loading}>
                Show More Shots
              </Button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-secondary text-failed">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}

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
        <GenerateDrafts projectId={projectId} onClose={() => setGenerateOpen(false)} />
      ) : null}
    </FillPage>
  );
}
