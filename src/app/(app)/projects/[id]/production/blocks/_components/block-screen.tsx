"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import type { BlockDetail } from "@/server/production";
import { Button, IconButton, ProgressBar, formatDurationLong } from "@/ui";
import { AssetThumb } from "../../_components/asset-thumb";
import { BackLink } from "../../_components/back-link";
import { usePolling } from "../../../_lib/use-polling";
import { blocksHref } from "../../../_lib/production-routes";
import {
  pollBlockAction,
  retryPreparationAction,
  reviewBlockAction,
  setAssetsAction,
} from "../actions";
import { blockKey } from "../_lib/block-key";
import { AssetPickerSheet } from "./asset-picker-sheet";
import { BlockStateLabel } from "./block-state-label";
import { PromptView } from "./prompt-view";
import { RequestChangesSheet, type IssueChoice } from "./request-changes-sheet";

export type BlockView = Omit<BlockDetail, "takes">;

const FAST_POLL_MS = 2000;
const SETTLED_POLL_MS = 10000;
/** When to check again after an action: its own refresh may have raced the server. */
const RECHECK_MS = [1000, 3500];

/**
 * Keeps the page in step with the server: polls quickly while the shot is being prepared and
 * slowly otherwise, so a refresh that was lost never leaves an old state on screen. `refresh` is
 * for after an action: it refreshes at once, then checks again shortly after.
 */
function useBlockSync(lineageId: string, block: BlockView) {
  const router = useRouter();
  const key = blockKey(block);
  const keyRef = useRef(key);
  const alive = useRef(true);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    keyRef.current = key;
  });
  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach(clearTimeout);
    };
  }, []);

  const check = useCallback(
    async (isActive: () => boolean) => {
      const next = await pollBlockAction(lineageId);
      if (isActive() && alive.current && next !== keyRef.current) router.refresh();
    },
    [lineageId, router],
  );

  const preparing = block.stage === "preparing" || block.busy;
  usePolling(check, true, preparing ? FAST_POLL_MS : SETTLED_POLL_MS);

  return useCallback(() => {
    if (!alive.current) return;
    router.refresh();
    timers.current.forEach(clearTimeout);
    timers.current = RECHECK_MS.map((ms) =>
      window.setTimeout(() => void check(() => alive.current).catch(() => {}), ms),
    );
  }, [check, router]);
}

const ANNOUNCEMENTS: Partial<Record<BlockView["stage"], string>> = {
  preparing: "Preparing the shot.",
  block_review: "The shot is ready to review.",
  approved: "The shot is approved.",
  prepare_failed: "The shot could not be prepared. The details are on the page.",
};

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const heading = title.toLowerCase().replaceAll(" ", "-");
  return (
    <section aria-labelledby={`block-${heading}`} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h3 id={`block-${heading}`} className="text-title-2">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One shot: its assets lead, then the script, the prepared prompt and what to do about it. */
export function BlockScreen({
  projectId,
  block,
  position,
  previousHref,
  nextHref,
  nextToReviewHref,
  issues,
  maxNote,
  maxAssets,
}: {
  projectId: string;
  block: BlockView;
  position: number;
  previousHref: string | null;
  nextHref: string | null;
  /** The next shot that waits for review, or the list when none does. */
  nextToReviewHref: string;
  issues: IssueChoice[];
  maxNote: number;
  maxAssets: number;
}) {
  const router = useRouter();
  const refresh = useBlockSync(block.lineageId, block);
  const [changesOpen, setChangesOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const [announcedStage, setAnnouncedStage] = useState(block.stage);
  const waitingRef = useRef<HTMLDivElement>(null);
  if (announcedStage !== block.stage) {
    setAnnouncedStage(block.stage);
    setAnnouncement(ANNOUNCEMENTS[block.stage] ?? "");
  }

  const preparing = block.stage === "preparing";
  const failed = block.stage === "prepare_failed";
  const approved = block.stage === "approved";
  const reviewable = block.stage === "block_review";
  const locked = preparing || block.busy;
  const attachedIds = block.assets.map((a) => a.assetId);
  const room = Math.max(0, maxAssets - attachedIds.length);
  const number = position;
  const title = block.title ?? `Shot ${number}`;

  // The waiting state takes focus, so the change is not silent for keyboard and screen reader users.
  const wasPreparing = useRef(preparing);
  useEffect(() => {
    if (preparing && !wasPreparing.current) waitingRef.current?.focus();
    wasPreparing.current = preparing;
  }, [preparing]);

  function approve() {
    setActionError(null);
    startPending(async () => {
      const result = await reviewBlockAction(projectId, block.lineageId, { decision: "accepted" });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      router.push(result.data.nextHref);
    });
  }

  function requestChanges(input: { issueCodes: string[]; note: string }) {
    setChangesError(null);
    startPending(async () => {
      const result = await reviewBlockAction(projectId, block.lineageId, {
        decision: "rejected",
        ...input,
      });
      if (!result.ok) {
        setChangesError(result.error);
        return;
      }
      setChangesOpen(false);
      refresh();
    });
  }

  function setAssets(assetIds: string[], from: "picker" | "tile") {
    setActionError(null);
    setPickerError(null);
    startPending(async () => {
      const result = await setAssetsAction(projectId, block.lineageId, assetIds);
      if (!result.ok) {
        if (from === "picker") setPickerError(result.error);
        else setActionError(result.error);
        return;
      }
      setPickerOpen(false);
      refresh();
    });
  }

  function retry() {
    setActionError(null);
    startPending(async () => {
      const result = await retryPreparationAction(projectId, block.lineageId);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-10">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BackLink href={blocksHref(projectId)}>Shots</BackLink>
          <nav aria-label="Shots" className="flex items-center gap-1">
            <IconButton
              label="Previous Shot"
              icon={<ChevronLeft />}
              disabled={!previousHref}
              render={previousHref ? <Link href={previousHref} /> : undefined}
            />
            <IconButton
              label="Next Shot"
              icon={<ChevronRight />}
              disabled={!nextHref}
              render={nextHref ? <Link href={nextHref} /> : undefined}
            />
          </nav>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-callout text-label-2 tabular-nums">Shot {number}</p>
            <h2 className="text-large-title text-balance">{title}</h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-callout text-label-2 tabular-nums">
              {block.durationSeconds ? (
                <span>{formatDurationLong(block.durationSeconds)}</span>
              ) : null}
              <BlockStateLabel stage={block.stage} />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {failed ? (
              <Button variant="prominent" size="large" loading={pending} onClick={retry}>
                Try Again
              </Button>
            ) : reviewable ? (
              <>
                <Button onClick={() => setChangesOpen(true)} disabled={pending}>
                  Request Changes
                </Button>
                <Button variant="prominent" size="large" loading={pending} onClick={approve}>
                  Approve
                </Button>
              </>
            ) : approved ? (
              <>
                <Button onClick={() => setChangesOpen(true)} disabled={pending}>
                  Request Changes
                </Button>
                <Button variant="prominent" size="large" render={<Link href={nextToReviewHref} />}>
                  {nextToReviewHref === blocksHref(projectId) ? "Back to Shots" : "Next to Review"}
                </Button>
              </>
            ) : null}
          </div>
        </div>
        {actionError ? (
          <p role="alert" className="max-w-(--measure) text-callout text-red">
            {actionError}
          </p>
        ) : null}
      </header>

      {preparing ? (
        <div ref={waitingRef} tabIndex={-1} className="flex max-w-sm flex-col gap-2.5 outline-none">
          <p className="text-body text-label">Preparing the shot…</p>
          <ProgressBar value={null} aria-label="Preparing the shot" />
          <p className="text-callout text-label-2">
            You can leave this page. The shot is ready to review when you return.
          </p>
        </div>
      ) : null}

      {failed ? (
        <p role="alert" className="max-w-(--measure) text-reading text-label">
          This shot could not be prepared. {block.failure}
        </p>
      ) : null}

      <Section
        title="Assets"
        action={
          <Button
            leadingIcon={<Plus aria-hidden />}
            onClick={() => {
              setPickerError(null);
              setPickerOpen(true);
            }}
            disabled={locked || room === 0 || pending}
          >
            Add Asset
          </Button>
        }
      >
        {block.assets.length > 0 ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-x-4 gap-y-6">
            {block.assets.map((asset) => (
              <li key={asset.ref} className="group/tile relative flex min-w-0 flex-col gap-2">
                <AssetThumb
                  fileId={asset.thumbnailFileId}
                  alt={`${asset.name}, sheet`}
                  className="w-full rounded-artwork"
                />
                <div className="flex flex-col gap-0.5 px-0.5">
                  <span className="line-clamp-2 text-headline">{asset.name}</span>
                  <span className="text-callout text-label-2 capitalize">{asset.kind}</span>
                </div>
                <IconButton
                  label={`Remove ${asset.name}`}
                  icon={<X />}
                  variant="standard"
                  disabled={locked || pending}
                  onClick={() =>
                    setAssets(
                      attachedIds.filter((id) => id !== asset.assetId),
                      "tile",
                    )
                  }
                  className="absolute top-2 right-2 rounded-full bg-elevated-3 hover:bg-elevated-3"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="max-w-(--measure) text-body text-label-2">
            No assets are attached. The clip is made from the prompt alone.
          </p>
        )}
        {room === 0 ? (
          <p className="text-callout text-label-2">That is as many as this shot can use.</p>
        ) : null}
      </Section>

      <Section title="Script">
        <p className="max-w-(--measure) text-script whitespace-pre-line text-label-2">
          {block.scriptExcerpt}
        </p>
      </Section>

      {block.prompt ? (
        <Section title="Prompt">
          <PromptView prompt={block.prompt} assets={block.assets} />
        </Section>
      ) : null}

      {block.notes.length > 0 ? (
        <Section title="Notes">
          <ul className="flex max-w-(--measure) flex-col gap-1.5">
            {block.notes.map((note, i) => (
              <li key={i} className="text-reading text-label-2">
                {note}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {changesOpen ? (
        <RequestChangesSheet
          open
          onOpenChange={setChangesOpen}
          issues={issues}
          maxNote={maxNote}
          sending={pending}
          serverError={changesError}
          onSubmit={requestChanges}
        />
      ) : null}
      {pickerOpen ? (
        <AssetPickerSheet
          open
          onOpenChange={setPickerOpen}
          projectId={projectId}
          attachedIds={attachedIds}
          room={room}
          maxAssets={maxAssets}
          saving={pending}
          serverError={pickerError}
          onConfirm={(ids) => setAssets(ids, "picker")}
        />
      ) : null}
    </div>
  );
}
