"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Repeat,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { fileSrc } from "@/lib/file-src";
import { IconButton, cn } from "@/ui";
import { formatClock, type Orientation } from "../../_lib/clip-view";
import { focusIsFree } from "../../_components/clips-context";

/** Clips are rendered at 24 frames per second; arrow keys step one frame. */
const FRAME = 1 / 24;
const SECOND_STEP = 1;

/** The frame: a reserved box of the film's shape, contained on black, never larger than the view. */
const FRAME_BOX: Record<Orientation, string> = {
  landscape: "aspect-video w-full max-h-[min(70dvh,48rem)]",
  portrait: "aspect-[9/16] h-[min(72dvh,48rem)] max-w-full mx-auto",
};

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function ControlButton({
  label,
  icon: Icon,
  pressed,
  shortcut,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  pressed?: boolean;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <IconButton
      label={label}
      shortcut={shortcut}
      tooltipSide="top"
      size="large"
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut === "Space" ? "Space K" : shortcut}
      onClick={onClick}
      icon={<Icon aria-hidden strokeWidth={1.75} />}
      className={cn(pressed === false && "text-label-2", pressed && "bg-fill-3")}
    />
  );
}

/**
 * A clip in a player drawn by the app: the poster until the first play, then the video, with
 * play and pause, a scrub bar, frame stepping, mute, loop and fullscreen. Keyboard: Space or K
 * plays and pauses, the arrow keys step one frame (with Shift one second), Home and End jump, M
 * mutes, L loops, F goes fullscreen. With `pageKeys`, the same keys work while nothing on the page
 * has focus.
 */
export function VideoPlayer({
  fileId,
  posterFileId,
  orientation,
  label,
  pageKeys = false,
  caption,
}: {
  fileId: string;
  posterFileId: string | null;
  orientation: Orientation;
  /** What the clip is, for assistive technology ("Draft 2 of The Harbour"). */
  label: string;
  pageKeys?: boolean;
  caption?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState(false);
  // The source's address redirects to a short-lived URL; a fresh one is fetched after an error.
  const [attempt, setAttempt] = useState(0);
  const resumeAt = useRef<number | null>(null);
  const dragging = useRef(false);

  const src = attempt === 0 ? fileSrc(fileId) : `${fileSrc(fileId)}?attempt=${attempt}`;

  // Follow playback every frame while playing, so the scrub bar moves smoothly.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && !dragging.current) setCurrent(video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // The element may load its metadata before React attaches its handlers (a server-rendered
  // page loads the video while it hydrates), so read the length from the element itself too.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    };
    const frame = requestAnimationFrame(sync);
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("durationchange", sync);
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("durationchange", sync);
    };
  }, [src]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      setStarted(true);
      void video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const end = Number.isFinite(video.duration) ? video.duration : 0;
    const next = Math.min(Math.max(0, time), end);
    video.currentTime = next;
    setCurrent(next);
    setStarted(true);
  }, []);

  const step = useCallback(
    (by: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      seek(video.currentTime + by);
    },
    [seek],
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  const toggleLoop = useCallback(() => setLoop((on) => !on), []);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    if (root.requestFullscreen) {
      void root.requestFullscreen().catch(() => {});
      return;
    }
    // iOS Safari: only the video element itself can go fullscreen.
    (videoRef.current as FullscreenVideo | null)?.webkitEnterFullscreen?.();
  }, []);

  /** Handles a player key; true when it was one. */
  const handleKey = useCallback(
    (key: string, shift: boolean): boolean => {
      switch (key) {
        case " ":
        case "k":
        case "K":
          toggle();
          return true;
        case "ArrowLeft":
        case ",":
          step(-(shift ? SECOND_STEP : FRAME));
          return true;
        case "ArrowRight":
        case ".":
          step(shift ? SECOND_STEP : FRAME);
          return true;
        case "Home":
          seek(0);
          return true;
        case "End":
          seek(Number.POSITIVE_INFINITY);
          return true;
        case "m":
        case "M":
          toggleMute();
          return true;
        case "l":
        case "L":
          toggleLoop();
          return true;
        case "f":
        case "F":
          toggleFullscreen();
          return true;
        default:
          return false;
      }
    },
    [seek, step, toggle, toggleFullscreen, toggleLoop, toggleMute],
  );

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    // Space and Enter on a control button press that button.
    const onButton = event.target instanceof HTMLButtonElement;
    if (onButton && (event.key === " " || event.key === "Enter")) return;
    if (handleKey(event.key, event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  // The same keys while nothing on the page has focus (the clip page's main player only).
  useEffect(() => {
    if (!pageKeys) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!focusIsFree()) return;
      if (handleKey(event.key, event.shiftKey)) event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleKey, pageKeys]);

  function positionFrom(event: ReactPointerEvent<HTMLDivElement>): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const ratio = Math.min(Math.max(0, (event.clientX - rect.left) / rect.width), 1);
    return ratio * duration;
  }

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const clock = `${formatClock(current)}`;

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      className={cn(
        "flex flex-col gap-2",
        fullscreen && "h-full justify-center bg-ground p-4 sm:p-6",
      )}
    >
      <figure
        aria-label={label}
        className={cn(
          "relative overflow-hidden bg-ground",
          fullscreen ? "min-h-0 w-full flex-1" : cn("rounded-artwork", FRAME_BOX[orientation]),
        )}
      >
        <video
          ref={videoRef}
          src={src}
          poster={posterFileId ? fileSrc(posterFileId) : undefined}
          preload="metadata"
          playsInline
          loop={loop}
          tabIndex={-1}
          onClick={toggle}
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            setDuration(Number.isFinite(video.duration) ? video.duration : 0);
            setFailed(false);
            if (resumeAt.current !== null) {
              video.currentTime = resumeAt.current;
              resumeAt.current = null;
            }
          }}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDuration(d);
          }}
          onTimeUpdate={(e) => {
            if (!dragging.current) setCurrent(e.currentTarget.currentTime);
          }}
          onSeeked={(e) => setCurrent(e.currentTarget.currentTime)}
          onPlay={() => {
            setPlaying(true);
            setStarted(true);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          onError={(e) => {
            if (attempt < 2) {
              resumeAt.current = e.currentTarget.currentTime || null;
              setAttempt((n) => n + 1);
              return;
            }
            setFailed(true);
            setPlaying(false);
          }}
          className="absolute inset-0 size-full cursor-pointer object-contain"
        />
        {!started && !failed ? (
          <button
            type="button"
            onClick={() => {
              toggle();
              // This button goes away once playback starts: focus moves to the player's own
              // play and pause control, so the keyboard stays in the player.
              requestAnimationFrame(() =>
                rootRef.current
                  ?.querySelector<HTMLButtonElement>('button[aria-keyshortcuts="Space K"]')
                  ?.focus({ preventScroll: true }),
              );
            }}
            aria-label={`Play ${label}`}
            className="group/play absolute inset-0 flex items-center justify-center focus-ring focus-visible:-outline-offset-4"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-accent/90 text-on-accent shadow-float transition-[background-color,scale] duration-(--dur-fast) group-hover/play:bg-accent group-active/play:scale-95 motion-reduce:transition-none">
              <Play aria-hidden fill="currentColor" strokeWidth={0} className="ml-1 size-7" />
            </span>
          </button>
        ) : null}
        {failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-elevated p-6 text-center">
            <p className="text-reading text-label-2">The clip could not be loaded.</p>
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
              className="rounded-control bg-fill-2 px-3 py-1 text-body text-label focus-ring hover:bg-fill"
            >
              Load Again
            </button>
          </div>
        ) : null}
      </figure>

      <div
        className={cn(
          "flex items-center gap-1 max-sm:flex-wrap max-sm:gap-y-0",
          orientation === "portrait" &&
            !fullscreen &&
            "mx-auto w-full max-w-[max(calc(min(72dvh,48rem)*9/16),22rem)]",
        )}
      >
        <ControlButton
          label={playing ? "Pause" : "Play"}
          icon={playing ? Pause : Play}
          shortcut="Space"
          onClick={toggle}
        />
        <span
          aria-hidden
          className="min-w-[4.5ch] shrink-0 px-1 text-callout text-label tabular-nums"
        >
          {clock}
        </span>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration * 10) / 10}
          aria-valuenow={Math.round(current * 10) / 10}
          aria-valuetext={`${formatClock(current)} elapsed, clip length ${formatClock(duration)}`}
          aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Home End"
          onPointerDown={(e) => {
            if (duration <= 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            dragging.current = true;
            seek(positionFrom(e));
          }}
          onPointerMove={(e) => {
            if (dragging.current) seek(positionFrom(e));
          }}
          onPointerUp={(e) => {
            dragging.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          className="group/scrub relative flex h-8 min-w-0 flex-1 cursor-pointer touch-none items-center rounded-control px-1.5 focus-ring max-sm:order-first max-sm:basis-full pointer-coarse:h-11"
        >
          <div ref={trackRef} className="relative h-1 w-full rounded-capsule bg-fill-2">
            <div
              className="absolute inset-y-0 left-0 rounded-capsule bg-accent"
              style={{ width: `${progress}%` }}
            />
            <div
              aria-hidden
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-float transition-[scale] duration-(--dur-fast) group-hover/scrub:scale-125 motion-reduce:transition-none"
              style={{ left: `${progress}%` }}
            />
          </div>
        </div>
        <span
          aria-hidden
          className="min-w-[4.5ch] shrink-0 px-1 text-right text-callout text-label-2 tabular-nums max-sm:mr-auto max-sm:text-left"
        >
          {formatClock(duration)}
        </span>
        <ControlButton
          label={muted ? "Unmute" : "Mute"}
          icon={muted ? VolumeX : Volume2}
          shortcut="M"
          onClick={toggleMute}
        />
        <ControlButton
          label="Loop"
          icon={Repeat}
          pressed={loop}
          shortcut="L"
          onClick={toggleLoop}
        />
        <ControlButton
          label={fullscreen ? "Exit Full Screen" : "Full Screen"}
          icon={fullscreen ? Minimize : Maximize}
          shortcut="F"
          onClick={toggleFullscreen}
        />
      </div>
      {caption && !fullscreen ? caption : null}
    </div>
  );
}
