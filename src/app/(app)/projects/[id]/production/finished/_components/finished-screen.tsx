"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Download, Play } from "lucide-react";
import type { ProductionPhase } from "@/server/production";
import { fileSrc } from "@/lib/file-src";
import { Button, ProgressBar, formatDurationLong, cn } from "@/ui";
import { phaseHref } from "../../../_lib/production-routes";
import { usePolling } from "../../../_lib/use-polling";
import {
  clipDownloadAction,
  loadClipsAction,
  pollExportAction,
  requestExportAction,
  type ExportView,
  type FinishedClip,
} from "../actions";
import { shotsWords } from "../../_components/format";
import { ClipPlayer } from "./clip-player";

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
    async (isActive) => {
      if (!workingId) return;
      const result = await pollExportAction(workingId);
      if (!isActive()) return;
      if (!result.ok) {
        setState({ phase: "failed", reason: result.error });
        return;
      }
      apply(result.data);
    },
    workingId !== null,
    1500,
  );

  return { state, start, starting };
}

function Poster({
  clip,
  number,
  portrait,
  onOpen,
  onDownload,
  downloading,
}: {
  clip: FinishedClip;
  number: number;
  portrait: boolean;
  onOpen: (clip: FinishedClip, trigger: HTMLElement) => void;
  onDownload: (clip: FinishedClip) => void;
  downloading: boolean;
}) {
  const title = clip.title ?? `Shot ${number}`;
  return (
    <li className="flex min-w-0 flex-col gap-2.5">
      <button
        type="button"
        onClick={(e) => onOpen(clip, e.currentTarget)}
        aria-label={`Play ${title}`}
        className={cn(
          "group/poster relative block w-full overflow-hidden rounded-artwork bg-elevated focus-ring outline-offset-4",
          portrait ? "aspect-[9/16]" : "aspect-video",
        )}
      >
        {clip.posterFileId ? (
          // eslint-disable-next-line @next/next/no-img-element -- stored media behind a redirect
          <img
            src={fileSrc(clip.posterFileId)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="absolute inset-0 size-full bg-ground object-contain"
          />
        ) : null}
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center bg-scrim opacity-0 transition-opacity duration-(--dur-base) group-hover/poster:opacity-100 group-focus-visible/poster:opacity-100 pointer-coarse:opacity-100"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-on-accent">
            <Play className="size-5 translate-x-px" fill="currentColor" />
          </span>
        </span>
      </button>
      <div className="flex items-start justify-between gap-3 px-0.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="line-clamp-2 text-headline">
            <span className="mr-2 text-label-2 tabular-nums">{number}</span>
            {title}
          </span>
          {clip.durationSeconds ? (
            <span className="text-callout text-label-2 tabular-nums">
              {formatDurationLong(clip.durationSeconds)}
            </span>
          ) : null}
        </div>
        <Button
          variant="plain"
          leadingIcon={<Download aria-hidden />}
          aria-label={`Download ${title}`}
          loading={downloading}
          onClick={() => onDownload(clip)}
        >
          Download
        </Button>
      </div>
    </li>
  );
}

/**
 * The finished film as a shelf: every final clip in story order, each playable and downloadable.
 * While some shots are made again (a script edit reopened the film), the final ones stay here and
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
  const [clips, setClips] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [playing, setPlaying] = useState<FinishedClip | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const exporting = useExport(projectId);

  function more() {
    if (!cursor) return;
    setError(null);
    startLoading(async () => {
      const result = await loadClipsAction(projectId, cursor);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setClips((list) => [...list, ...result.data.items]);
      setCursor(result.data.nextCursor);
    });
  }

  async function download(clip: FinishedClip) {
    setError(null);
    setSaving(clip.lineageId);
    try {
      const result = await clipDownloadAction(clip.lineageId);
      if (result.ok) saveFrom(result.data);
      else setError(result.error);
    } finally {
      setSaving(null);
    }
  }

  const { state } = exporting;
  const working = state.phase === "working";

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="text-large-title">Finished</h2>
          {complete ? (
            <p className="max-w-(--measure) text-reading text-label-2">
              Every shot of this film, ready for your editor. The script, assets and takes remain
              available in the earlier stages.
            </p>
          ) : (
            <p className="max-w-(--measure) text-reading text-label-2">
              Some shots are not final yet. The final clips below can be watched and downloaded now.
              Download All is available once every shot is final.
            </p>
          )}
        </div>
        {complete ? (
          <Button
            variant="prominent"
            size="large"
            leadingIcon={<Download aria-hidden />}
            loading={exporting.starting || working}
            onClick={exporting.start}
          >
            Download All
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="prominent"
              size="large"
              render={<Link href={phaseHref(projectId, phase, projectStage)} />}
            >
              {phase === "preparing" || phase === "block_review" ? "Review Shots" : "Open Clips"}
            </Button>
          </div>
        )}
      </header>

      <div aria-live="polite" className="flex flex-col gap-2.5 empty:hidden">
        {working ? (
          <div className="flex max-w-sm flex-col gap-2.5">
            <p className="text-body text-label">Preparing the download…</p>
            <ProgressBar value={null} aria-label="Preparing the download" />
            <p className="text-callout text-label-2 tabular-nums">
              Packing {shotsWords(state.clipCount)} into one ZIP. The download starts when it is
              ready.
            </p>
          </div>
        ) : null}
        {state.phase === "ready" ? (
          <p className="text-callout text-label-2">
            The download has started. If nothing happened,{" "}
            <button
              type="button"
              onClick={() => saveFrom(state.url)}
              className="rounded-control text-label underline underline-offset-2 focus-ring"
            >
              Download Again
            </button>
            .
          </p>
        ) : null}
        {state.phase === "failed" ? (
          <p role="alert" className="max-w-(--measure) text-callout text-red">
            {state.reason}
          </p>
        ) : null}
      </div>

      <section aria-label="Clips" className="flex flex-col gap-6">
        <ol
          className={cn(
            "grid gap-x-5 gap-y-9",
            portrait
              ? "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]"
              : "grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))]",
          )}
        >
          {clips.map((clip) => (
            <Poster
              key={clip.lineageId}
              clip={clip}
              number={clip.orderIndex + 1}
              portrait={portrait}
              onOpen={(c, trigger) => {
                returnFocus.current = trigger;
                setPlaying(c);
              }}
              onDownload={download}
              downloading={saving === clip.lineageId}
            />
          ))}
        </ol>
        {cursor ? (
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
    </div>
  );
}
