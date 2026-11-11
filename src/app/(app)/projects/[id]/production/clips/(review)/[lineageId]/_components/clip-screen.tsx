"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BlockDetail, BlockProductionStage, TakeView } from "@/server/production";
import { Button, IconButton, StatusLine, cn, useToast } from "@/ui";
import { useRefreshReviewList } from "../../../../_components/review-list-context";
import { usePolling } from "../../../../../_lib/use-polling";
import {
  CLIP_STATE_LABELS,
  CLIP_STATE_TONES,
  TAKE_STATUS_LABELS,
  detailKey,
  formatLength,
  isBeforeClips,
  isRendering,
  isUnsettled,
  needsReview,
  newestPlayable,
  shotNumber,
  shotTitle,
  takeLabels,
  type Orientation,
} from "../../../_lib/clip-view";
import type { ShotRef } from "../../../_lib/clip-data";
import { boardHref, clipHref } from "../../../_lib/routes";
import { pollClipAction, reviewTakeAction } from "../../../actions";
import { useClips, useShown } from "../../../_components/clips-context";
import { ShotDetails } from "./shot-details";
import {
  BeforeClipsPanel,
  DonePanel,
  FailedPanel,
  RenderingPanel,
  ReviewPanel,
  type Prices,
  type ReviewRequest,
} from "./stage-rail";
import { TakesStrip } from "./takes-strip";
import type { IssueChoice } from "./shared";
import { VideoPlayer } from "./video-player";

const FAST_POLL_MS = 2000;
const SETTLED_POLL_MS = 10000;
/** When to check again after an action: its own refresh may have raced the server. */
const RECHECK_MS = [1000, 3500];

/** What a screen reader hears when the shot moves on by itself. */
const ANNOUNCEMENTS: Record<BlockProductionStage, string> = {
  preparing: "The shot is being prepared.",
  prepare_failed: "The shot could not be prepared.",
  block_review: "The shot is waiting for its review in Shots.",
  approved: "The shot is approved.",
  draft_generating: "Rendering the draft.",
  draft_review: "The draft is ready to review.",
  final_generating: "Finishing in full quality.",
  final_review: "The final is ready to review.",
  done: "The shot is final.",
  failed: "The clip could not be made. The reason is on the page.",
};

/**
 * Keeps the page in step with the server: polls always (fast while something renders), and after
 * an action refreshes at once, then checks again shortly after.
 */
function useClipSync(lineageId: string, key: string, unsettled: boolean) {
  const router = useRouter();
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
      const next = await pollClipAction(lineageId);
      if (isActive() && alive.current && next !== null && next !== keyRef.current) {
        router.refresh();
      }
    },
    [lineageId, router],
  );

  usePolling(check, true, unsettled ? FAST_POLL_MS : SETTLED_POLL_MS);

  return useCallback(() => {
    if (!alive.current) return;
    router.refresh();
    timers.current.forEach(clearTimeout);
    timers.current = RECHECK_MS.map((ms) =>
      window.setTimeout(() => void check(() => alive.current).catch(() => {}), ms),
    );
  }, [check, router]);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.closest("[role='dialog'],[role='alertdialog'],[data-change-request]") !== null
  );
}

function decisionWords(stage: TakeView["stage"], decision: ReviewRequest["decision"]): string {
  if (decision === "rejected") return "Changes requested. A new draft is rendering.";
  return stage === "draft" ? "Draft accepted. The final is rendering." : "The shot is final.";
}

/** The caption under the player when it shows an older take than the latest. */
function heldCaption(stage: BlockProductionStage, label: string): string {
  switch (stage) {
    case "draft_generating":
      return `${label}, shown while the new draft renders.`;
    case "final_generating":
      return `${label}, shown while the final renders.`;
    case "failed":
      return `${label}, the last clip that was made.`;
    default:
      return label;
  }
}

export interface ClipScreenProps {
  projectId: string;
  orientation: Orientation;
  shot: BlockDetail;
  neighbours: { previous: ShotRef | null; next: ShotRef | null };
  prices: Prices;
  balance: number;
  issues: IssueChoice[];
  maxNote: number;
}

/**
 * One shot in the focus area of the clip review: its title and state, the clip large, what to
 * decide about it right under the clip, then its takes and what it was made from.
 */
export function ClipScreen(props: ClipScreenProps) {
  const { projectId, orientation, shot, neighbours, prices, balance } = props;
  const router = useRouter();
  const toast = useToast();
  const { announce, markArrival } = useClips();
  const shown = useShown();
  const refreshList = useRefreshReviewList();
  const refresh = useClipSync(shot.lineageId, detailKey(shot), isUnsettled(shot.stage, shot.busy));

  // Announce a stage change, but not the stage the page opened on.
  const announcedStage = useRef(shot.stage);
  useEffect(() => {
    if (announcedStage.current === shot.stage) return;
    announcedStage.current = shot.stage;
    announce(ANNOUNCEMENTS[shot.stage]);
  }, [announce, shot.stage]);

  const title = shotTitle(shot);
  const labels = useMemo(() => takeLabels(shot.takes), [shot.takes]);
  const latest = shot.takes[0] ?? null;
  const current = latest?.fileId ? latest : newestPlayable(shot.takes);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing =
    viewingId !== null && viewingId !== current?.id
      ? (shot.takes.find((t) => t.id === viewingId && t.fileId !== null) ?? null)
      : null;
  const playing = viewing ?? current;
  const playingLabel = playing ? (labels.get(playing.id) ?? "Take") : null;

  // Decisions: accept or request changes, then move on to the next shot waiting for review.
  const [deciding, setDeciding] = useState<"accepted" | "rejected" | null>(null);
  const [, startDeciding] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  function decide(take: TakeView, review: ReviewRequest, fromAsk: boolean) {
    (fromAsk ? setAskError : setError)(null);
    setDeciding(review.decision);
    startDeciding(async () => {
      try {
        const result = await reviewTakeAction(
          projectId,
          { lineageId: shot.lineageId, orderIndex: shot.orderIndex },
          take.id,
          review,
        );
        if (!result.ok) {
          (fromAsk ? setAskError : setError)(result.error);
          return;
        }
        setAsking(false);
        refreshList();
        const words = decisionWords(take.stage, review.decision);
        const next = result.data.next;
        markArrival();
        if (next) {
          toast.success(
            words,
            `Next to review: Shot ${shotNumber(next.orderIndex)}, ${shotTitle(next)}.`,
          );
          router.push(clipHref(projectId, next.lineageId));
        } else {
          toast.success(words, "No other shot is waiting for review.");
          router.push(boardHref(projectId));
        }
      } finally {
        setDeciding(null);
      }
    });
  }

  // [ and ] go to the previous and next shot.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;
      const target =
        event.key === "[" ? neighbours.previous : event.key === "]" ? neighbours.next : null;
      if (!target) return;
      event.preventDefault();
      router.push(clipHref(projectId, target.lineageId));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [neighbours.next, neighbours.previous, projectId, router]);

  function panel() {
    const stage = shot.stage;
    if (isBeforeClips(stage) || stage === "prepare_failed") {
      return (
        <BeforeClipsPanel
          shown={shown}
          projectId={projectId}
          stage={stage}
          failure={shot.failure}
        />
      );
    }
    if (needsReview(stage) && latest) {
      return (
        <ReviewPanel
          key={latest.id}
          shown={shown}
          take={latest}
          label={labels.get(latest.id) ?? "Take"}
          prices={prices}
          balance={balance}
          issues={props.issues}
          maxNote={props.maxNote}
          deciding={deciding}
          error={error}
          askError={askError}
          asking={asking}
          onAsk={(open) => {
            setAskError(null);
            setAsking(open);
          }}
          onDecide={(review, fromAsk) => decide(latest, review, fromAsk)}
        />
      );
    }
    if (isRendering(stage)) return <RenderingPanel shown={shown} stage={stage} />;
    if (stage === "failed" && latest) {
      return (
        <FailedPanel
          key={latest.id}
          shown={shown}
          projectId={projectId}
          take={latest}
          prices={prices}
          balance={balance}
          onDone={() => {
            refresh();
            refreshList();
          }}
        />
      );
    }
    if (stage === "done" && latest) {
      return <DonePanel shown={shown} take={latest} label={labels.get(latest.id) ?? "Final"} />;
    }
    return null;
  }

  const length = formatLength(shot.durationSeconds);
  const meta = [`Shot ${shotNumber(shot.orderIndex)}`, length, CLIP_STATE_LABELS[shot.stage]]
    .filter(Boolean)
    .join(" · ");

  return (
    <article aria-labelledby="clip-title" className="flex flex-col gap-12">
      <div className="flex flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2
              id="clip-title"
              className="text-heading-sm font-semibold tracking-[-0.02em] text-balance break-words"
            >
              {title}
            </h2>
            <StatusLine tone={CLIP_STATE_TONES[shot.stage]}>{meta}</StatusLine>
          </div>
          <nav aria-label="Previous and next shot" className="flex shrink-0 items-center gap-1">
            <ShotLink projectId={projectId} target={neighbours.previous} direction="previous" />
            <ShotLink projectId={projectId} target={neighbours.next} direction="next" />
          </nav>
        </header>

        {viewing ? (
          <div className="flex swap-in flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card bg-elevated px-4 py-3">
            <p className="text-body text-label">
              {playingLabel} · {TAKE_STATUS_LABELS[viewing.status]}.{" "}
              <span className="text-label-2">Earlier takes are read-only.</span>
            </p>
            <Button variant="plain" onClick={() => setViewingId(null)} className="-mr-1">
              Back to Current
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start gap-x-10 gap-y-8">
          <div className="min-w-0 flex-[999_1_560px]">
            {playing?.fileId ? (
              <VideoPlayer
                key={playing.id}
                fileId={playing.fileId}
                posterFileId={playing.posterFileId}
                orientation={orientation}
                label={`${playingLabel} of ${title}`}
                pageKeys
                caption={
                  <div className="flex flex-col gap-1 px-0.5">
                    {!viewing && playing.id !== latest?.id && playingLabel ? (
                      <p className="text-secondary text-label-2">
                        {heldCaption(shot.stage, playingLabel)}
                      </p>
                    ) : null}
                    {playing.isSample && (viewing || playing.id !== latest?.id) ? (
                      <p className="text-secondary text-label-2">
                        Sample clip. A placeholder from the test generator, not a real result.
                      </p>
                    ) : null}
                  </div>
                }
              />
            ) : (
              <EmptyFrame orientation={orientation} rendering={isRendering(shot.stage)} />
            )}
          </div>
          <div className="flex max-w-160 min-w-0 flex-[1_1_20rem] flex-col gap-5">{panel()}</div>
        </div>
      </div>

      <TakesStrip
        takes={shot.takes}
        labels={labels}
        orientation={orientation}
        shownId={playing?.id ?? null}
        currentId={current?.id ?? null}
        onSelect={(id) => {
          setViewingId(id);
          if (!id) return;
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
        }}
      />

      <ShotDetails
        projectId={projectId}
        scriptExcerpt={shot.scriptExcerpt}
        assets={shot.assets}
        prompt={shot.prompt}
      />
    </article>
  );
}

function ShotLink({
  projectId,
  target,
  direction,
}: {
  projectId: string;
  target: ShotRef | null;
  direction: "previous" | "next";
}) {
  const label = direction === "previous" ? "Previous Shot" : "Next Shot";
  const icon = direction === "previous" ? <ChevronLeft /> : <ChevronRight />;
  const shortcut = direction === "previous" ? "[" : "]";
  if (!target) {
    return <IconButton label={label} icon={icon} disabled tooltip={false} />;
  }
  return (
    <IconButton
      label={`${label}: ${shotTitle(target)}`}
      shortcut={shortcut}
      icon={icon}
      variant="outlined"
      aria-keyshortcuts={shortcut}
      render={<Link href={clipHref(projectId, target.lineageId)} />}
    />
  );
}

/** The reserved frame when the shot has no clip to play yet: a flat tile, never a fake picture. */
function EmptyFrame({ orientation, rendering }: { orientation: Orientation; rendering: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-card bg-elevated text-meta text-label-3",
        orientation === "portrait"
          ? "mx-auto aspect-[9/16] w-[min(100%,calc(max(18rem,calc(100dvh_-_var(--toolbar-h)_-_20rem))*9/16))]"
          : "mx-auto aspect-video w-[min(100%,calc(max(18rem,calc(100dvh_-_var(--toolbar-h)_-_20rem))*16/9))]",
        rendering && "animate-pulse motion-reduce:animate-none",
      )}
    >
      {rendering ? "Rendering" : "No clip yet"}
    </div>
  );
}
