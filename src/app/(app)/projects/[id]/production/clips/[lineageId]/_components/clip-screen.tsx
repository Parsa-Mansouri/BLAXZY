"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Film } from "lucide-react";
import type { BlockDetail, BlockProductionStage, TakeView } from "@/server/production";
import { Button, IconButton, cn, useToast } from "@/ui";
import { usePolling } from "../../../../_lib/use-polling";
import {
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
} from "../../_lib/clip-view";
import type { ShotRef } from "../../_lib/clip-data";
import { boardHref, clipHref } from "../../_lib/routes";
import { pollClipAction, reviewTakeAction } from "../../actions";
import { ClipState } from "../../_components/clip-state";
import { useClips, useShown } from "../../_components/clips-context";
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
    target.closest("[role='dialog'],[role='alertdialog']") !== null
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

/** One shot: its clip large, what to decide about it beside, its takes below. */
export function ClipScreen(props: ClipScreenProps) {
  const { projectId, orientation, shot, neighbours, prices, balance } = props;
  const router = useRouter();
  const toast = useToast();
  const { announce, markArrival } = useClips();
  const shown = useShown();
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
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function decide(take: TakeView, review: ReviewRequest, fromSheet: boolean) {
    (fromSheet ? setSheetError : setError)(null);
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
          (fromSheet ? setSheetError : setError)(result.error);
          return;
        }
        setSheetOpen(false);
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
          sheetError={sheetError}
          sheetOpen={sheetOpen}
          onSheetOpen={(open) => {
            setSheetError(null);
            setSheetOpen(open);
          }}
          onDecide={(review, fromSheet) => decide(latest, review, fromSheet)}
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
          onDone={refresh}
        />
      );
    }
    if (stage === "done" && latest) {
      return <DonePanel shown={shown} take={latest} label={labels.get(latest.id) ?? "Final"} />;
    }
    return null;
  }

  const length = formatLength(shot.durationSeconds);

  return (
    <div className="@container flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div>
          <Link
            href={boardHref(projectId)}
            className="-ml-1 inline-flex items-center gap-0.5 rounded-control py-0.5 pr-1.5 text-body text-label-2 focus-ring transition-colors duration-(--dur-fast) hover:text-label"
          >
            <ChevronLeft aria-hidden="true" className="size-(--icon)" />
            Clips
          </Link>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="text-large-title text-balance break-words">{title}</h2>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-callout text-label-2">
              <span className="tabular-nums">
                Shot {shotNumber(shot.orderIndex)}
                {length ? ` · ${length}` : ""}
              </span>
              <ClipState stage={shot.stage} />
            </div>
          </div>
          <nav aria-label="Shots" className="flex shrink-0 items-center gap-1">
            <ShotLink projectId={projectId} target={neighbours.previous} direction="previous" />
            <ShotLink projectId={projectId} target={neighbours.next} direction="next" />
          </nav>
        </div>
      </header>

      {viewing ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-group bg-elevated px-4 py-3">
          <p className="text-body text-label">
            {playingLabel} · {TAKE_STATUS_LABELS[viewing.status]}.{" "}
            <span className="text-label-2">Earlier takes are read-only.</span>
          </p>
          <Button variant="plain" onClick={() => setViewingId(null)} className="-mr-2">
            Back to Current
          </Button>
        </div>
      ) : null}

      <div className="grid items-start gap-x-12 gap-y-8 @4xl:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] @4xl:grid-rows-[auto_1fr]">
        <div className="min-w-0 @4xl:col-start-1 @4xl:row-start-1">
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
                    <p className="text-callout text-label-2">
                      {heldCaption(shot.stage, playingLabel)}
                    </p>
                  ) : null}
                  {playing.isSample && (viewing || playing.id !== latest?.id) ? (
                    <p className="text-callout text-label-2">
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
        <div className="flex min-w-0 flex-col gap-10 @4xl:col-start-2 @4xl:row-span-2 @4xl:row-start-1 @4xl:pt-1">
          <div className="flex flex-col gap-5">{panel()}</div>
          <ShotDetails
            projectId={projectId}
            scriptExcerpt={shot.scriptExcerpt}
            assets={shot.assets}
            prompt={shot.prompt}
          />
        </div>
        <div className="min-w-0 @4xl:col-start-1 @4xl:row-start-2">
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
        </div>
      </div>
    </div>
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
    return <IconButton label={label} icon={icon} size="large" disabled tooltip={false} />;
  }
  return (
    <IconButton
      label={`${label}: ${shotTitle(target)}`}
      shortcut={shortcut}
      icon={icon}
      size="large"
      variant="standard"
      className="rounded-full"
      aria-keyshortcuts={shortcut}
      render={<Link href={clipHref(projectId, target.lineageId)} />}
    />
  );
}

/** The reserved frame when the shot has no clip to play yet. */
function EmptyFrame({ orientation, rendering }: { orientation: Orientation; rendering: boolean }) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-artwork bg-elevated",
        orientation === "portrait"
          ? "mx-auto aspect-[9/16] h-[min(72dvh,48rem)] max-w-full"
          : "aspect-video max-h-[min(70dvh,48rem)] w-full",
        rendering && "animate-pulse motion-reduce:animate-none",
      )}
    >
      <Film aria-hidden strokeWidth={1.25} className="size-10 text-label-3" />
    </div>
  );
}
