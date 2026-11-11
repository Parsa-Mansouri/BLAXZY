"use client";

import { useRef, useState, useTransition } from "react";
import { Download } from "lucide-react";
import { Button, PageHeader, ProgressBar, StatusLine, cn, formatDurationLong, stagger } from "@/ui";
import { PosterTile } from "../../_components/poster-tile";
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

/**
 * The finished film as a shelf: every final clip in story order as a poster card. Hovering or
 * focusing a card slides up Play and Download; Download All packs every clip into one ZIP.
 */
export function FinishedScreen({
  projectId,
  initial,
  initialCursor,
  portrait,
}: {
  projectId: string;
  initial: FinishedClip[];
  initialCursor: string | null;
  portrait: boolean;
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
    <>
      <PageHeader
        title="Finished"
        description="Every shot of this film, ready for your editor."
        actions={
          <Button
            variant="primary"
            size="large"
            leadingIcon={<Download aria-hidden />}
            loading={exporting.starting || working}
            onClick={exporting.start}
          >
            Download All
          </Button>
        }
      />

      <div aria-live="polite" className="mb-10 flex in-2 flex-col gap-3 empty:hidden">
        {working ? (
          <div className="flex max-w-sm flex-col gap-3">
            <StatusLine tone="working">
              Packing {shotsWords(state.clipCount)} into one ZIP
            </StatusLine>
            <ProgressBar value={null} aria-label="Preparing the download" />
            <p className="text-secondary text-label-2">The download starts when it is ready.</p>
          </div>
        ) : null}
        {state.phase === "ready" ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusLine tone="done">The download has started</StatusLine>
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
              ? "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]"
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
                  coverHeading={title}
                  coverLine={
                    clip.durationSeconds ? (
                      <p className="text-secondary text-label-2 tabular-nums">
                        {formatDurationLong(clip.durationSeconds)}
                      </p>
                    ) : null
                  }
                  actions={
                    <>
                      <Button
                        variant="dark"
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
    </>
  );
}
