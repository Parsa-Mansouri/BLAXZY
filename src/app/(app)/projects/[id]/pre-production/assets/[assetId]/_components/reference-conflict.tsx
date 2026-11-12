"use client";

import { useId, useRef, useState } from "react";
import { fileSrc } from "@/lib/file-src";
import { ProgressBar, cn } from "@/ui";
import type { DesignerInfo } from "../_lib/designer-view";
import type { LookReference } from "../_lib/look-review";
import { IMAGE_ACCEPT, uploadReferencePhoto } from "../_lib/reference-upload";
import { Caps, ChoiceTile } from "./desk";
import { roleLabel } from "./reference-photos";
import { ErrorLine } from "./shared";

/** Small thumbnails of reference photos, each captioned with its role. */
export function ReferenceThumbs({
  references,
  designer,
  className,
}: {
  references: readonly LookReference[];
  designer: Pick<DesignerInfo, "roles"> | null;
  className?: string;
}) {
  if (references.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-3", className)}>
      {references.map((ref) => {
        const role = designer ? roleLabel(designer, ref.role) : ref.role;
        return (
          <li key={ref.fileId} className="flex w-20 flex-col gap-1.5">
            <span className="relative block aspect-square overflow-hidden rounded-item bg-elevated">
              {/* eslint-disable-next-line @next/next/no-img-element -- user media from object storage */}
              <img
                src={fileSrc(ref.fileId)}
                alt={`Reference photo: ${role}`}
                loading="lazy"
                decoding="async"
                draggable={false}
                className="absolute inset-0 size-full object-cover"
              />
            </span>
            <span className="leading-tight font-mono text-meta tracking-caps text-label-2 uppercase">
              {role}
            </span>
            {ref.note ? (
              <span className="line-clamp-2 text-meta text-pretty text-label-3" title={ref.note}>
                {ref.note}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A change that goes against a reference photo: the photos involved and two choices, in place —
 * use a new photo for that role (uploaded here, it takes the first photo's place), or drop the
 * photo. Either choice is final and sends the request.
 */
export function ReferenceConflictChoice({
  assetId,
  title,
  message,
  photos,
  designer,
  sending,
  onReplace,
  onDrop,
}: {
  assetId: string;
  title: string;
  message: string;
  /** The photos the change goes against. */
  photos: readonly LookReference[];
  designer: Pick<DesignerInfo, "roles">;
  sending: boolean;
  onReplace: (fileId: string) => void;
  onDrop: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploading = progress !== null;
  const several = photos.length > 1;

  async function upload(file: File) {
    setError(null);
    setProgress(0);
    const result = await uploadReferencePhoto(assetId, file, setProgress);
    setProgress(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onReplace(result.fileId);
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex swap-in flex-col gap-4 rounded-tile border border-outline-quiet bg-ground p-4"
    >
      <div className="flex flex-col gap-2">
        <Caps as="h3" id={`${id}-title`}>
          {title}
        </Caps>
        <p className="text-body text-pretty text-label">{message}</p>
      </div>
      <ReferenceThumbs references={photos} designer={designer} />
      <div className="grid grid-cols-2 gap-2">
        <ChoiceTile
          action
          size="large"
          label="Use a New Photo"
          line={several ? "It takes the first photo’s place." : "It takes this photo’s place."}
          on={uploading}
          disabled={sending || uploading}
          onPick={() => input.current?.click()}
        />
        <ChoiceTile
          action
          size="large"
          label={several ? "Drop the Photos" : "Drop the Photo"}
          line="The change is made without it."
          on={false}
          disabled={sending || uploading}
          onPick={onDrop}
        />
      </div>
      {uploading ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <ProgressBar value={progress} aria-label="Uploading the new photo" />
          <p className="text-meta text-label-2 tabular-nums">Uploading… {Math.round(progress)}%</p>
        </div>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}
