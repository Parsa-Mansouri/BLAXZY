"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { AudioLines, ImageUp } from "lucide-react";
import { fileMime, fileProblem, uploadViaTicket } from "@/lib/upload";
import { useAbortOnUnmount } from "@/app/(app)/_lib/use-abort-on-unmount";
import { Button, DemoHint, DropScene, ProgressBar, cn } from "@/ui";
import { createAssetUploadAction, finishAssetUploadAction } from "../actions";
import { IMAGE_TYPES, MAX_PHOTO_BYTES } from "../_lib/reference-upload";
import { useAssetScreen } from "./asset-context";
import { useFileDrop } from "./use-file-drop";
import { ErrorLine } from "@/app/(app)/_components/values";

const MAX_BYTES = MAX_PHOTO_BYTES;

const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; progress: number }
  | { kind: "finishing"; name: string };

/**
 * Drop or choose a file, upload it straight to storage with progress, then hand it to the asset.
 * `audio` takes a voice recording; otherwise a reference image. `initialFile` (a file dropped
 * elsewhere, e.g. on the Upload an Image tile) starts uploading as soon as the zone appears.
 */
export function UploadZone({
  projectId,
  assetId,
  assetName,
  audio = false,
  disabled = false,
  grow = false,
  initialFile,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  audio?: boolean;
  disabled?: boolean;
  /** Let the drop area grow to fill the space it is given. */
  grow?: boolean;
  /** Upload this file once, on mount. It goes through the same checks as a dropped file. */
  initialFile?: File;
}) {
  const { moveOn } = useAssetScreen();
  const id = useId();
  const signal = useAbortOnUnmount();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const busy = disabled || phase.kind !== "idle";
  const types = audio ? AUDIO_TYPES : IMAGE_TYPES;
  const formats = audio ? "MP3, WAV or M4A" : "PNG, JPEG or WebP";

  async function upload(file: File) {
    setError(null);
    const problem = fileProblem(file, {
      types,
      maxBytes: MAX_BYTES,
      messages: {
        type: `This file type cannot be used. Choose a ${formats} file.`,
        empty: "This file is empty. Choose another one.",
        size: audio
          ? "This file is larger than 25 MB. Export a shorter or compressed recording."
          : "This image is larger than 25 MB. Export a smaller version and try again.",
      },
    });
    if (problem) {
      setError(problem);
      return;
    }
    setPhase({ kind: "uploading", name: file.name, progress: 0 });
    const result = await uploadViaTicket({
      createTicket: () =>
        createAssetUploadAction(assetId, {
          name: file.name,
          type: fileMime(file, types),
          size: file.size,
        }),
      file,
      confirm: (fileId) => finishAssetUploadAction(projectId, assetId, fileId),
      onProgress: (progress) => setPhase({ kind: "uploading", name: file.name, progress }),
      onPhase: (next) => {
        if (next === "confirming") setPhase({ kind: "finishing", name: file.name });
      },
      signal: signal(),
      uploadFailedMessage: "The upload failed. Check your connection and choose the file again.",
    });
    if (!result.ok) {
      if (result.aborted) return;
      setPhase({ kind: "idle" });
      setError(result.error);
      return;
    }
    // A recording makes the voice ready, so the user moves on; an image stays here for review.
    moveOn(result.confirmed, `${assetName}’s voice is ready`);
  }

  const { dragging, dropProps } = useFileDrop({
    disabled: busy,
    onFile: (file) => void upload(file),
  });

  // The file handed over on arrival is uploaded once (the ref also covers Strict Mode's second
  // effect run in development).
  const started = useRef<File | null>(null);
  const startInitial = useEffectEvent((file: File) => void upload(file));
  useEffect(() => {
    if (!initialFile || started.current === initialFile) return;
    started.current = initialFile;
    startInitial(initialFile);
    // Strict Mode's simulated unmount aborts this upload, so the remount starts it again.
    return () => {
      started.current = null;
    };
  }, [initialFile]);

  const Icon = audio ? AudioLines : ImageUp;

  return (
    <div className={cn("flex flex-col gap-3", grow && "flex-1")}>
      <div
        {...dropProps}
        className={cn(
          grow && "flex-1",
          phase.kind === "idle" && "demo-host",
          "flex min-h-52 flex-col items-center justify-center gap-3 rounded-block border border-dashed px-5 py-8 text-center transition-colors duration-(--dur-press)",
          dragging ? "border-brand bg-elevated-2" : "border-separator-opaque bg-elevated",
        )}
      >
        {phase.kind === "idle" ? (
          <>
            {disabled ? null : (
              <DemoHint delay={600} mask="none" className={cn(dragging && "invisible")}>
                <DropScene variant={audio ? "audio" : "image"} />
              </DemoHint>
            )}
            <Icon aria-hidden="true" className="size-5 text-label-2" strokeWidth={1.5} />
            <p className="text-body text-label-2">
              {audio ? "Drop a recording here, or" : "Drop an image here, or"}
            </p>
            <Button
              variant="primary"
              size="large"
              onClick={() => input.current?.click()}
              disabled={busy}
            >
              Choose File
            </Button>
            <input
              ref={input}
              id={`${id}-file`}
              type="file"
              accept={Object.keys(types)
                .map((ext) => `.${ext}`)
                .join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
          </>
        ) : (
          <div
            className="flex w-full max-w-sm flex-col items-stretch gap-3 text-left"
            aria-live="polite"
          >
            <p className="truncate font-mono text-body text-label">{phase.name}</p>
            <ProgressBar
              value={phase.kind === "uploading" ? phase.progress : null}
              aria-label="Upload progress"
            />
            <p className="text-meta text-label-2 tabular-nums">
              {phase.kind === "uploading"
                ? `Uploading… ${Math.round(phase.progress)}%`
                : audio
                  ? "Saving the recording…"
                  : "Preparing the image…"}
            </p>
          </div>
        )}
      </div>
      <ErrorLine>{error}</ErrorLine>
      <p className="text-secondary text-label-2">
        {audio
          ? "MP3, WAV or M4A, up to 25 MB. A clean recording of the voice alone works best."
          : "PNG, JPEG or WebP, up to 25 MB. The subject alone, whole and evenly lit works best."}
      </p>
    </div>
  );
}
