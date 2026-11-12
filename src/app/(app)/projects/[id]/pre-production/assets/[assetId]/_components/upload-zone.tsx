"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { AudioLines, ImageUp } from "lucide-react";
import { Button, ProgressBar, cn } from "@/ui";
import { createAssetUploadAction, finishAssetUploadAction } from "../actions";
import { useAssetScreen } from "./asset-context";
import { ErrorLine } from "./shared";

const MB = 1024 * 1024;
const MAX_BYTES = 25 * MB;

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; progress: number }
  | { kind: "finishing"; name: string };

/** PUTs the file to the presigned URL, reporting progress. */
function putFile(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error()));
    xhr.onerror = () => reject(new Error());
    xhr.onabort = () => reject(new Error());
    xhr.send(file);
  });
}

/**
 * Drop or choose a file, upload it straight to storage with progress, then hand it to the asset.
 * `audio` takes a voice recording; otherwise a reference image.
 */
export function UploadZone({
  projectId,
  assetId,
  audio = false,
  disabled = false,
  grow = false,
}: {
  projectId: string;
  assetId: string;
  audio?: boolean;
  disabled?: boolean;
  /** Let the drop area grow to fill the space it is given. */
  grow?: boolean;
}) {
  const { refresh } = useAssetScreen();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = disabled || phase.kind !== "idle";
  const types = audio ? AUDIO_TYPES : IMAGE_TYPES;
  const formats = audio ? "MP3, WAV or M4A" : "PNG, JPEG or WebP";

  async function upload(file: File) {
    setError(null);
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const type = types[extension];
    if (!type) {
      setError(`This file type cannot be used. Choose a ${formats} file.`);
      return;
    }
    if (file.size === 0) {
      setError("This file is empty. Choose another one.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        audio
          ? "This file is larger than 25 MB. Export a shorter or compressed recording."
          : "This image is larger than 25 MB. Export a smaller version and try again.",
      );
      return;
    }
    setPhase({ kind: "uploading", name: file.name, progress: 0 });
    const ticket = await createAssetUploadAction(assetId, {
      name: file.name,
      type,
      size: file.size,
    });
    if (!ticket.ok) {
      setPhase({ kind: "idle" });
      setError(ticket.error);
      return;
    }
    try {
      await putFile(ticket.data.uploadUrl, ticket.data.headers, file, (progress) =>
        setPhase({ kind: "uploading", name: file.name, progress }),
      );
    } catch {
      setPhase({ kind: "idle" });
      setError("The upload failed. Check your connection and choose the file again.");
      return;
    }
    setPhase({ kind: "finishing", name: file.name });
    const finished = await finishAssetUploadAction(projectId, assetId, ticket.data.fileId);
    if (!finished.ok) {
      setPhase({ kind: "idle" });
      setError(finished.error);
      return;
    }
    refresh();
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }

  const Icon = audio ? AudioLines : ImageUp;

  return (
    <div className={cn("flex flex-col gap-3", grow && "flex-1")}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          grow && "flex-1",
          "flex min-h-52 flex-col items-center justify-center gap-3 rounded-block border border-dashed px-5 py-8 text-center transition-colors duration-(--dur-press)",
          dragging ? "border-brand bg-elevated-2" : "border-separator-opaque bg-elevated",
        )}
      >
        {phase.kind === "idle" ? (
          <>
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
