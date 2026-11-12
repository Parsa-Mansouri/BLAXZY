"use client";

import { StatusDot, cn, type StatusTone } from "@/ui";
import type { PackPicture } from "../_lib/sheet-review";
import { Artwork } from "./shared";

const WORDS: Partial<Record<PackPicture["status"], { text: string; tone: StatusTone }>> = {
  hero: { text: "The approved design", tone: "done" },
  accepted: { text: "Approved", tone: "done" },
  in_review: { text: "To review", tone: "waiting" },
};

/**
 * A pack's pictures side by side, each in its own ratio: the approved Hero first, then the views
 * (only views that have an image: nothing stands in for one still to come). With `onSelect` each
 * picture opens that view.
 */
export function PackGallery({
  pictures,
  assetName,
  selectedKey = null,
  onSelect,
  className,
}: {
  pictures: readonly PackPicture[];
  assetName: string;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  className?: string;
}) {
  if (pictures.length === 0) return null;
  return (
    <ul className={cn("grid grid-cols-2 items-start gap-x-4 gap-y-6 sm:grid-cols-3", className)}>
      {pictures.map((picture) => {
        const words = WORDS[picture.status];
        const selected = picture.key === selectedKey;
        const body = (
          <>
            <Artwork
              fileId={picture.fileId}
              alt={`${assetName}, ${picture.label}`}
              shape={picture.aspectRatio ?? "16:9"}
              size="inset"
              className={cn(
                "transition-[box-shadow] duration-(--dur-press)",
                selected && "ring-2 ring-brand ring-offset-2 ring-offset-ground",
              )}
            />
            <span className="flex flex-col gap-0.5 px-0.5">
              <span className="text-meta font-medium break-words text-label">{picture.label}</span>
              {words ? (
                <span className="flex items-center gap-1.5 text-meta text-label-2">
                  <StatusDot tone={words.tone} />
                  {words.text}
                </span>
              ) : null}
            </span>
          </>
        );
        return (
          <li key={picture.key} className="min-w-0">
            {onSelect ? (
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(picture.key)}
                className="group flex w-full press flex-col gap-2 rounded-tile text-left focus-ring"
              >
                {body}
              </button>
            ) : (
              <figure className="flex flex-col gap-2">{body}</figure>
            )}
          </li>
        );
      })}
    </ul>
  );
}
