"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Download, Pause, Play, X } from "lucide-react";
import { fileSrc } from "@/lib/file-src";
import { Button, IconButton } from "@/ui";
import { clock } from "../../_components/format";

export interface PlayerClip {
  lineageId: string;
  title: string;
  fileId: string;
  posterFileId: string | null;
}

/**
 * One clip full screen on black, with its own simple controls: play and pause, a scrubber, the
 * time, Download and Close. Escape closes; focus returns to the poster that opened it.
 */
export function ClipPlayer({
  clip,
  onClose,
  onDownload,
  downloading,
  returnFocus,
}: {
  clip: PlayerClip;
  onClose: () => void;
  onDownload: () => void;
  downloading: boolean;
  returnFocus: React.RefObject<HTMLElement | null>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    // Opening is a user action, so playback may start at once; if the browser refuses, the
    // play button is there.
    void video.current?.play().catch(() => {});
  }, []);

  function toggle() {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setFailed(true));
    else element.pause();
  }

  function seek(value: number) {
    const element = video.current;
    if (!element) return;
    element.currentTime = value;
    setTime(value);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== " " || event.defaultPrevented) return;
    const target = event.target;
    if (target instanceof HTMLElement && /^(BUTTON|INPUT|A)$/.test(target.tagName)) return;
    event.preventDefault();
    toggle();
  }

  const percent = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <BaseDialog.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-(--z-overlay) bg-ground" />
        <BaseDialog.Viewport className="fixed inset-0 z-(--z-modal)">
          <BaseDialog.Popup
            finalFocus={returnFocus}
            onKeyDown={onKeyDown}
            className="flex size-full flex-col bg-ground text-label outline-none"
          >
            <div className="flex items-center justify-between gap-4 px-(--content-x) py-3">
              <BaseDialog.Title className="min-w-0 truncate text-row font-semibold">
                {clip.title}
              </BaseDialog.Title>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="dark"
                  size="small"
                  leadingIcon={<Download aria-hidden />}
                  onClick={onDownload}
                  loading={downloading}
                >
                  Download
                </Button>
                <BaseDialog.Close render={<IconButton label="Close" icon={<X />} />} />
              </div>
            </div>
            <BaseDialog.Description className="sr-only">
              Space plays and pauses. Escape closes the player.
            </BaseDialog.Description>

            <div className="relative min-h-0 flex-1">
              {/* The clip is user media behind a redirect; the controls below are our own. */}
              <video
                ref={video}
                src={fileSrc(clip.fileId)}
                poster={clip.posterFileId ? fileSrc(clip.posterFileId) : undefined}
                playsInline
                preload="metadata"
                aria-label={clip.title}
                onClick={toggle}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration);
                  // The first attempt may come before the clip is ready.
                  if (!tried.current) void e.currentTarget.play().catch(() => {});
                  tried.current = true;
                }}
                onError={() => setFailed(true)}
                className="absolute inset-0 size-full bg-ground object-contain"
              />
              {failed ? (
                <p
                  role="alert"
                  className="absolute inset-x-0 bottom-4 text-center text-secondary text-label-2"
                >
                  This clip could not be played. Download it instead.
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-3 px-(--content-x) py-3">
              <IconButton
                label={playing ? "Pause" : "Play"}
                icon={playing ? <Pause /> : <Play />}
                onClick={toggle}
              />
              <span className="w-10 shrink-0 text-meta text-label-2 tabular-nums">
                {clock(time)}
              </span>
              <div className="relative flex h-8 min-w-0 flex-1 items-center rounded-row focus-ring-within">
                <div className="h-1 w-full overflow-hidden rounded-capsule bg-fill-2">
                  <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
                </div>
                <div
                  aria-hidden
                  className="absolute size-3 -translate-x-1/2 rounded-full bg-accent"
                  style={{ left: `${percent}%` }}
                />
                <input
                  type="range"
                  aria-label="Position"
                  aria-valuetext={clock(time)}
                  min={0}
                  max={duration > 0 ? duration : 0}
                  step={0.05}
                  value={Math.min(time, duration || 0)}
                  disabled={duration <= 0}
                  onChange={(e) => seek(Number(e.target.value))}
                  className="absolute inset-0 size-full cursor-pointer opacity-0 outline-none disabled:cursor-default"
                />
              </div>
              <span className="w-10 shrink-0 text-right text-meta text-label-2 tabular-nums">
                {clock(duration)}
              </span>
            </div>
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
