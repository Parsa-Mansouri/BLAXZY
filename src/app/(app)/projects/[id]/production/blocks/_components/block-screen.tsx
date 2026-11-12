"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { BlockDetail } from "@/server/production";
import {
  Button,
  PaperSheet,
  PictureTile,
  ProgressBar,
  StatusLine,
  formatDurationLong,
  stagger,
} from "@/ui";
import { fileSrc } from "@/lib/file-src";
import { ChangeRequest, type IssueChoice } from "../../_components/change-request";
import { useRefreshReviewList } from "../../_components/review-list-context";
import { usePolling } from "../../../_lib/use-polling";
import { blocksHref } from "../../../_lib/production-routes";
import {
  pollBlockAction,
  retryPreparationAction,
  reviewBlockAction,
  setAssetsAction,
} from "../actions";
import { focusIsFree, markArrival, takeArrival } from "../_lib/arrival";
import { blockKey } from "../_lib/block-key";
import { BLOCK_STATE_TONES, blockStateLabel, scriptChangeNotice } from "../_lib/block-state";
import { AssetPickerSheet } from "./asset-picker-sheet";
import { PromptView } from "./prompt-view";

export type { IssueChoice };
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
  // One set for the component's life, so the unmount cleanup clears the timers set last.
  const timers = useRef(new Set<number>());
  useEffect(() => {
    keyRef.current = key;
  });
  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const check = useCallback(
    async (isActive: () => boolean) => {
      // Never after the page was left: the action would be posted from another page.
      if (!isActive() || !alive.current) return;
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
    const pending = timers.current;
    pending.forEach(clearTimeout);
    pending.clear();
    for (const ms of RECHECK_MS) {
      const timer = window.setTimeout(() => {
        pending.delete(timer);
        void check(() => alive.current).catch(() => {});
      }, ms);
      pending.add(timer);
    }
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
  headingRef,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  /** Makes the heading a focus target (it then takes focus after a change in its section). */
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const heading = `block-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-4">
      <div className="flex min-h-(--btn-sm) items-center justify-between gap-4">
        <h3
          ref={headingRef}
          id={heading}
          tabIndex={headingRef ? -1 : undefined}
          className="scroll-mt-[calc(var(--toolbar-h)+1rem)] text-section outline-none"
        >
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One shot in the focus area of the shot review: its title, state and decision first, then the
 * assets it shows, its script on paper and the prepared prompt. "Request Changes" replaces the
 * decision with the issue chips and a note, in place.
 */
export function BlockScreen({
  projectId,
  block,
  position,
  nextToReviewHref,
  issues,
  maxNote,
  maxAssets,
}: {
  projectId: string;
  block: BlockView;
  position: number;
  /** The next shot that waits for review, or the list when none does. */
  nextToReviewHref: string;
  issues: IssueChoice[];
  maxNote: number;
  maxAssets: number;
}) {
  const router = useRouter();
  const refresh = useBlockSync(block.lineageId, block);
  const refreshList = useRefreshReviewList();
  const [asking, setAsking] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();
  // An asset change makes a new version that is prepared again: from the click until that version
  // arrives, the shot shows (and says) Preparing, as after Request Changes.
  const [rePreparing, setRePreparing] = useState<string | null>(null);
  const stage = rePreparing === block.id ? "preparing" : block.stage;
  const [announcement, setAnnouncement] = useState("");
  const [announced, setAnnounced] = useState(`${block.lineageId}:${stage}`);
  if (announced !== `${block.lineageId}:${stage}`) {
    setAnnounced(`${block.lineageId}:${stage}`);
    setAnnouncement(ANNOUNCEMENTS[stage] ?? "");
  }
  const waitingRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const assetsRef = useRef<HTMLHeadingElement>(null);
  const lastAction = useRef<"assets" | null>(null);

  const preparing = stage === "preparing";
  const failed = stage === "prepare_failed";
  const approved = stage === "approved";
  const reviewable = stage === "block_review";
  const locked = preparing || block.busy;
  const attachedIds = block.assets.map((a) => a.assetId);
  const room = Math.max(0, maxAssets - attachedIds.length);
  const title = block.title ?? `Shot ${position}`;
  const canAsk = (reviewable || approved) && !asking;
  const changeNotice = scriptChangeNotice(block);

  // Arriving from Approve on the previous shot: focus starts at this shot's heading.
  useEffect(() => {
    if (takeArrival()) titleRef.current?.focus({ preventScroll: true });
  }, [block.lineageId]);

  // The waiting state takes focus, so the change is not silent for keyboard and screen reader
  // users. When the control that had focus went away (a removed asset, a button disabled while the
  // shot is prepared again), focus moves to where the change is instead of the page's body.
  const wasPreparing = useRef(preparing);
  const lastState = useRef(`${block.id}:${stage}`);
  useEffect(() => {
    // Only after a change, not when the page is first shown.
    if (lastState.current === `${block.id}:${stage}`) return;
    lastState.current = `${block.id}:${stage}`;
    const started = preparing && !wasPreparing.current;
    wasPreparing.current = preparing;
    if (started) {
      waitingRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!focusIsFree()) return;
    const target = lastAction.current === "assets" ? assetsRef.current : titleRef.current;
    target?.focus({ preventScroll: true });
  }, [preparing, block.id, stage]);

  function approve() {
    setActionError(null);
    startPending(async () => {
      const result = await reviewBlockAction(projectId, block.lineageId, { decision: "accepted" });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      refreshList();
      markArrival();
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
      setAsking(false);
      refresh();
      refreshList();
    });
  }

  function setAssets(assetIds: string[], from: "picker" | "tile") {
    setActionError(null);
    setPickerError(null);
    lastAction.current = "assets";
    const version = block.id;
    // The removed tile's button goes away: keep focus in the assets section.
    if (from === "tile") assetsRef.current?.focus({ preventScroll: true });
    startPending(async () => {
      const result = await setAssetsAction(projectId, block.lineageId, assetIds);
      if (!result.ok) {
        if (from === "picker") setPickerError(result.error);
        else setActionError(result.error);
        return;
      }
      setRePreparing(version);
      setPickerOpen(false);
      refresh();
      refreshList();
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
      refreshList();
    });
  }

  const meta = [
    `Shot ${position}`,
    block.durationSeconds ? formatDurationLong(block.durationSeconds) : null,
    blockStateLabel(stage),
  ]
    .filter(Boolean)
    .join(" · ");

  function decision() {
    if (failed) {
      return (
        <Button variant="primary" size="large" loading={pending} onClick={retry}>
          Try Again
        </Button>
      );
    }
    if (!canAsk) return null;
    const ask = (
      <Button
        size="large"
        onClick={() => {
          setChangesError(null);
          setAsking(true);
        }}
        disabled={pending}
      >
        Request Changes
      </Button>
    );
    if (reviewable) {
      return (
        <>
          {ask}
          <Button variant="primary" size="large" loading={pending} onClick={approve}>
            Approve
          </Button>
        </>
      );
    }
    return (
      <>
        {ask}
        {nextToReviewHref !== blocksHref(projectId) ? (
          <Button variant="primary" size="large" render={<Link href={nextToReviewHref} />}>
            Next to Review
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <article aria-labelledby="shot-title" className="flex flex-col gap-12">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2
              ref={titleRef}
              tabIndex={-1}
              id="shot-title"
              className="scroll-mt-[calc(var(--toolbar-h)+1rem)] text-heading-sm font-semibold tracking-[-0.02em] text-balance break-words outline-none"
            >
              {title}
            </h2>
            <StatusLine tone={BLOCK_STATE_TONES[stage]}>{meta}</StatusLine>
          </div>
          {!asking ? <div className="flex flex-wrap items-center gap-2">{decision()}</div> : null}
        </header>
        {changeNotice ? (
          <p className="max-w-(--measure) text-body text-label">{changeNotice}</p>
        ) : null}
        {actionError ? (
          <p role="alert" className="max-w-(--measure) text-secondary text-failed">
            {actionError}
          </p>
        ) : null}
        {asking ? (
          <div className="max-w-180">
            <ChangeRequest
              issues={issues}
              maxNote={maxNote}
              sending={pending}
              serverError={changesError}
              notePlaceholder="What the shot should do differently."
              onSubmit={requestChanges}
              onCancel={() => setAsking(false)}
            />
          </div>
        ) : null}
        {preparing ? (
          <div
            ref={waitingRef}
            tabIndex={-1}
            className="flex max-w-sm flex-col gap-3 rounded-card bg-elevated p-5 outline-none"
          >
            <p className="text-body text-label">The shot is being prepared.</p>
            <ProgressBar value={null} aria-label="Preparing the shot" />
            <p className="text-secondary text-label-2">
              You can leave this page. The shot is ready to review when you return.
            </p>
          </div>
        ) : null}
        {failed ? (
          <p role="alert" className="max-w-(--measure) text-body text-label">
            This shot could not be prepared. {block.failure}
          </p>
        ) : null}
      </div>

      <Section
        title="Assets"
        headingRef={assetsRef}
        action={
          <Button
            size="small"
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
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-x-4 gap-y-6">
            {block.assets.map((asset, i) => (
              <li key={asset.ref} className="min-w-0 enter" style={stagger(i, 60)}>
                <PictureTile
                  label={asset.name}
                  aspect="video"
                  picture={
                    asset.thumbnailFileId ? (
                      // eslint-disable-next-line @next/next/no-img-element -- stored media behind a redirect
                      <img
                        src={fileSrc(asset.thumbnailFileId)}
                        alt={`${asset.name}, sheet`}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                      />
                    ) : undefined
                  }
                  placeholder="No image yet"
                  dashed
                  coverHeading={asset.name}
                  coverLine={<p className="text-secondary text-label-2 capitalize">{asset.kind}</p>}
                  actions={
                    <Button
                      variant="dark"
                      disabled={locked || pending}
                      onClick={() =>
                        setAssets(
                          attachedIds.filter((id) => id !== asset.assetId),
                          "tile",
                        )
                      }
                    >
                      Remove from Shot
                    </Button>
                  }
                  caption={asset.name}
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
          <p className="text-secondary text-label-2">That is as many as this shot can use.</p>
        ) : null}
      </Section>

      {block.scriptExcerpt.trim() ? (
        <Section title="Script">
          <PaperSheet as="div" className="max-w-205">
            <p className="whitespace-pre-line">{block.scriptExcerpt.trim()}</p>
          </PaperSheet>
        </Section>
      ) : null}

      {block.prompt ? (
        <Section title="Prompt">
          <PromptView prompt={block.prompt} assets={block.assets} />
        </Section>
      ) : null}

      {block.notes.length > 0 ? (
        <Section title="Notes">
          <ul className="flex max-w-(--measure) flex-col gap-1.5">
            {block.notes.map((note, i) => (
              <li key={i} className="text-body text-label-2">
                {note}
              </li>
            ))}
          </ul>
        </Section>
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
    </article>
  );
}
