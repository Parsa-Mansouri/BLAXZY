"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Download, Play } from "lucide-react";
import type { ProductionPhase } from "@/server/production";
import {
  Button,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatusLine,
  cn,
  formatDurationLong,
  stagger,
  useToast,
} from "@/ui";
import { DrawnTick } from "../../_components/feedback";
import { FillPage } from "../../_components/fill-page";
import { POSTER_SHAPES, PosterTile } from "../../_components/poster-tile";
import { phaseHref } from "../../../_lib/production-routes";
import { pollExport } from "@/app/(app)/_lib/poll-client";
import { usePolling } from "@/app/(app)/_lib/use-polling";
import { mergeLoadedPages, useServerSnapshot } from "@/app/(app)/_lib/use-server-snapshot";
import {
  clipDownloadAction,
  loadClipsAction,
  requestExportAction,
  type ExportView,
  type FinishedClip,
} from "../actions";
import { shotsWords } from "../../_components/format";
import { afterExportPoll } from "../_lib/export-poll";
import { ClipPlayer } from "./clip-player";
import { Mono } from "@/app/(app)/_components/values";

/** Saves a file from a link the server signed, without leaving the page. */
function saveFrom(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

type ExportState =
  | { phase: "idle" }
  | { phase: "working"; id: string; clipCount: number }
  | { phase: "ready"; url: string }
  | { phase: "failed"; reason: string };

/** The ZIP of every clip: asks for it, waits for the worker, then starts the download. */
function useExport(projectId: string) {
  const [state, setState] = useState<ExportState>({ phase: "idle" });
  const [starting, startStarting] = useTransition();
  const pollFailures = useRef(0);

  function apply(view: ExportView) {
    if (view.status === "ready" && view.downloadUrl) {
      setState({ phase: "ready", url: view.downloadUrl });
      saveFrom(view.downloadUrl);
    } else if (view.status === "failed") {
      setState({
        phase: "failed",
        reason: view.failure ?? "The download could not be prepared.",
      });
    } else {
      setState({ phase: "working", id: view.id, clipCount: view.clipCount });
    }
  }

  function start() {
    pollFailures.current = 0;
    startStarting(async () => {
      const result = await requestExportAction(projectId);
      if (!result.ok) {
        setState({ phase: "failed", reason: result.error });
        return;
      }
      apply(result.data);
    });
  }

  const workingId = state.phase === "working" ? state.id : null;
  usePolling(
    async (isActive, signal) => {
      if (!workingId) return;
      const result = await pollExport(workingId, { signal });
      if (!isActive()) return;
      // One bad answer (a dropped request, a restart) is not the end of the export.
      const run = afterExportPoll(pollFailures.current, result.ok);
      pollFailures.current = run.failures;
      if (!result.ok) {
        if (run.giveUp) setState({ phase: "failed", reason: result.error });
        return;
      }
      apply(result.data);
    },
    workingId !== null,
    1500,
  );

  return { state, start, starting };
}

/**
 * The finished film as a shelf: every final clip in story order as a poster card. Hovering or
 * focusing a card slides up Play and Download; Download All packs every clip into one ZIP. While
 * some shots are made again (a script edit reopened the film), the final ones stay here and
 * Download All waits until every shot is final.
 */
export function FinishedScreen({
  projectId,
  initial,
  initialCursor,
  portrait,
  complete,
  projectStage,
  phase,
}: {
  projectId: string;
  initial: FinishedClip[];
  initialCursor: string | null;
  portrait: boolean;
  /** Every shot is final. */
  complete: boolean;
  projectStage: "production" | "done";
  phase: ProductionPhase;
}) {
  const toast = useToast();
  const first = useMemo(
    () => ({ clips: initial, cursor: initialCursor }),
    [initial, initialCursor],
  );
  // A refresh brings page one again; pages loaded with Load More stay.
  const [{ clips, cursor }, setShelf] = useServerSnapshot(first, (current, fresh) => {
    const merged = mergeLoadedPages({
      current: current.clips,
      currentCursor: current.cursor,
      fresh: fresh.clips,
      freshCursor: fresh.cursor,
      id: (clip) => clip.lineageId,
    });
    return { clips: merged.items, cursor: merged.cursor };
  });
  const loadingMore = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [playing, setPlaying] = useState<FinishedClip | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const exporting = useExport(projectId);

  function more() {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    setError(null);
    startLoading(async () => {
      try {
        const result = await loadClipsAction(projectId, cursor);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setShelf((shelf) => ({
          clips: [...shelf.clips, ...result.data.items],
          cursor: result.data.nextCursor,
        }));
      } catch {
        setError("Could not load more clips. Check your connection and try again.");
      } finally {
        loadingMore.current = false;
      }
    });
  }

  async function download(clip: FinishedClip) {
    setError(null);
    setSaving(clip.lineageId);
    try {
      const result = await clipDownloadAction(clip.lineageId);
      if (result.ok) {
        saveFrom(result.data);
        toast.show({
          kind: "success",
          title: "Download started",
          description: clip.title ?? `Shot ${clip.orderIndex + 1}`,
        });
      } else setError(result.error);
    } finally {
      setSaving(null);
    }
  }

  const { state } = exporting;
  const working = state.phase === "working";
  /** A short film gets larger posters. */
  const few = clips.length <= 4 && !cursor;

  return (
    <FillPage>
      <PageHeader
        title={complete ? "Finished Film" : "Final Clips"}
        description={
          complete
            ? "Every shot of this film, ready for your editor."
            : "Some shots are not final yet. Their final clips can be watched and downloaded here, and Download All opens once every shot is final."
        }
        actions={
          complete ? (
            <Button
              variant="primary"
              size="large"
              className="pl-6"
              leadingIcon={<Download aria-hidden strokeWidth={1.5} />}
              loading={exporting.starting || working}
              onClick={exporting.start}
            >
              Download All
            </Button>
          ) : (
            <Button
              variant="primary"
              size="large"
              render={<Link href={phaseHref(projectId, phase, projectStage)} />}
            >
              {phase === "preparing" || phase === "block_review" ? "Review Shots" : "Open Clips"}
            </Button>
          )
        }
      />

      <div aria-live="polite" className="mb-10 flex in-2 flex-col gap-3 empty:hidden">
        {working ? (
          <div className="flex max-w-sm flex-col gap-3">
            <StatusLine tone="working">
              Packing <span className="tabular-nums">{shotsWords(state.clipCount)}</span> into one
              ZIP
            </StatusLine>
            <ProgressBar value={null} aria-label="Preparing the download" />
            <p className="text-secondary text-pretty text-label-2">
              The download starts when it is ready.
            </p>
          </div>
        ) : null}
        {state.phase === "ready" ? (
          <div className="flex swap-in flex-wrap items-center gap-x-4 gap-y-2">
            <p className="flex items-center gap-2 text-secondary text-label">
              <DrawnTick draw />
              The download has started
            </p>
            <Button variant="plain" size="small" onClick={() => saveFrom(state.url)}>
              Download Again
            </Button>
          </div>
        ) : null}
        {state.phase === "failed" ? (
          <p role="alert" className="max-w-(--measure)">
            <StatusLine as="span" tone="failed">
              {state.reason}
            </StatusLine>
          </p>
        ) : null}
      </div>

      <section aria-label="Clips" className="flex in-3 flex-col gap-8">
        <ol
          className={cn(
            "grid gap-x-7 gap-y-10",
            portrait
              ? few
                ? "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]"
                : "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]"
              : few
                ? "grid-cols-[repeat(auto-fill,minmax(min(100%,28rem),1fr))]"
                : "grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))]",
          )}
        >
          {clips.map((clip, i) => {
            const number = clip.orderIndex + 1;
            const title = clip.title ?? `Shot ${number}`;
            return (
              <li key={clip.lineageId} className="min-w-0 enter" style={stagger(Math.min(i, 12))}>
                <PosterTile
                  label={`${number}, ${title}`}
                  shape={portrait ? "portrait" : "landscape"}
                  posterFileId={clip.posterFileId}
                  placeholder={clip.posterFileId ? undefined : "No poster"}
                  coverLine={
                    clip.durationSeconds ? (
                      <p className="text-secondary text-label-2">
                        <span className="sr-only">Length </span>
                        <Mono>{formatDurationLong(clip.durationSeconds)}</Mono>
                      </p>
                    ) : null
                  }
                  actions={
                    <>
                      <Button
                        variant="dark"
                        className="pl-4"
                        leadingIcon={
                          <Play aria-hidden strokeWidth={1.5} className="translate-x-px" />
                        }
                        aria-label={`Play ${title}`}
                        onClick={(e) => {
                          returnFocus.current = e.currentTarget;
                          setPlaying(clip);
                        }}
                      >
                        Play
                      </Button>
                      <Button
                        variant="dark"
                        className="pl-4"
                        leadingIcon={<Download aria-hidden strokeWidth={1.5} />}
                        aria-label={`Download ${title}`}
                        loading={saving === clip.lineageId}
                        onClick={() => void download(clip)}
                      >
                        Download
                      </Button>
                    </>
                  }
                  caption={
                    <>
                      <span className="mr-2 text-label-2 tabular-nums">{number}</span>
                      {title}
                    </>
                  }
                />
              </li>
            );
          })}
          {loading
            ? Array.from({ length: 2 }, (_, i) => (
                <li key={`pending-${i}`} aria-hidden className="flex min-w-0 flex-col gap-3">
                  <Skeleton
                    className={cn(
                      "w-full rounded-card",
                      POSTER_SHAPES[portrait ? "portrait" : "landscape"],
                    )}
                  />
                  <Skeleton className="h-5 w-2/3 rounded-paper" />
                </li>
              ))
            : null}
        </ol>
        {cursor ? (
          <div>
            <Button size="small" onClick={more} loading={loading}>
              Show More Clips
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-secondary text-failed">
            {error}
          </p>
        ) : null}
      </section>

      {playing ? (
        <ClipPlayer
          clip={{
            lineageId: playing.lineageId,
            title: playing.title ?? `Shot ${playing.orderIndex + 1}`,
            fileId: playing.fileId,
            posterFileId: playing.posterFileId,
          }}
          onClose={() => setPlaying(null)}
          onDownload={() => void download(playing)}
          downloading={saving === playing.lineageId}
          returnFocus={returnFocus}
        />
      ) : null}
    </FillPage>
  );
}
