"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import { Pause, Play } from "lucide-react";
import type { LookView } from "@/server/assets";
import { fileSrc } from "@/lib/file-src";
import { Button, IconButton, cn } from "@/ui";
import { UploadZone } from "./upload-zone";
import { When } from "./shared";

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A recording with a play button, a scrubber and the time; drawn, not the browser's controls. */
export function AudioPlayer({ fileId, label }: { fileId: string; label: string }) {
  const id = useId();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const percent = duration > 0 ? (time / duration) * 100 : 0;

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setFailed(true));
    else el.pause();
  }

  return (
    <div className="flex w-full max-w-xl flex-col gap-2">
      <div className="flex items-center gap-3">
        <IconButton
          label={playing ? `Pause ${label}` : `Play ${label}`}
          tooltip={false}
          variant="prominent"
          size="large"
          icon={playing ? <Pause /> : <Play />}
          onClick={toggle}
          disabled={failed}
          className="rounded-full"
        />
        <label htmlFor={`${id}-seek`} className="sr-only">
          Position in {label}
        </label>
        <input
          id={`${id}-seek`}
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          disabled={failed || duration === 0}
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          onChange={(e) => {
            const el = audio.current;
            const next = Number(e.target.value);
            if (el) el.currentTime = next;
            setTime(next);
          }}
          style={{ "--played": `${percent}%` } as CSSProperties}
          className={cn(
            "h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-capsule focus-ring",
            "bg-[linear-gradient(to_right,var(--label)_var(--played),var(--fill-3)_var(--played))]",
            "[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-label",
            "[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-label",
            "disabled:cursor-default disabled:opacity-40",
          )}
        />
        <span className="shrink-0 text-callout text-label-2 tabular-nums">
          {clock(time)} / {clock(duration)}
        </span>
      </div>
      {failed ? (
        <p role="alert" className="text-callout text-red">
          This recording cannot be played here. Upload it again as an MP3 file.
        </p>
      ) : null}
      <audio
        ref={audio}
        src={fileSrc(fileId)}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

/** A voice: upload a recording, then listen to it. Voices have no image and no sheet. */
export function VoiceStage({
  projectId,
  assetId,
  assetName,
  recording,
  busy,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  /** The accepted recording, when there is one. */
  recording: LookView | null;
  busy: boolean;
}) {
  const [replacing, setReplacing] = useState(false);

  if (recording?.fileId && !replacing) {
    return (
      <section aria-labelledby="voice-title" className="flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h3 id="voice-title" className="text-title-1">
            Recording
          </h3>
          <p className="text-callout text-label-2">
            Recording {recording.versionNumber} · Uploaded · <When date={recording.createdAt} />
          </p>
        </div>
        <AudioPlayer fileId={recording.fileId} label={`${assetName} recording`} />
        <div>
          <Button onClick={() => setReplacing(true)} disabled={busy}>
            Replace Recording
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="voice-title" className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h3 id="voice-title" className="text-title-1">
          {replacing ? "Replace Recording" : "Add a Recording"}
        </h3>
        <p className="text-reading text-label-2">
          Upload a recording of {assetName}’s voice. It is used as is: there is nothing to generate
          or review.
        </p>
      </div>
      <UploadZone projectId={projectId} assetId={assetId} audio />
      {replacing ? (
        <div>
          <Button onClick={() => setReplacing(false)}>Cancel</Button>
        </div>
      ) : null}
    </section>
  );
}
