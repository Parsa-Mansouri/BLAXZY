"use client";

import { Film, Loader, TriangleAlert } from "lucide-react";
import type { TakeView } from "@/server/production";
import { fileSrc } from "@/lib/file-src";
import { cn } from "@/ui";
import { TAKE_STATUS_LABELS, type Orientation } from "../../_lib/clip-view";

/**
 * Every take of the shot, newest first, as small posters with their name and status. Choosing one
 * plays it read-only in the player; choosing the shown one again goes back to the current take.
 */
export function TakesStrip({
  takes,
  labels,
  orientation,
  shownId,
  currentId,
  onSelect,
}: {
  takes: TakeView[];
  labels: Map<string, string>;
  orientation: Orientation;
  /** The take the player shows. */
  shownId: string | null;
  /** The take the page is about (the latest); choosing it is going back to current. */
  currentId: string | null;
  onSelect: (takeId: string | null) => void;
}) {
  return (
    <section aria-labelledby="takes-title" className="flex flex-col gap-3 pt-8 hairline-t">
      <h3 id="takes-title" className="text-title-2">
        Takes
      </h3>
      {takes.length === 0 ? (
        <p className="text-body text-label-2">Every draft and final of this shot is kept here.</p>
      ) : (
        <ul className="-mx-2 flex snap-x gap-3 overflow-x-auto px-2 pt-1 pb-3">
          {takes.map((take) => {
            const shown = take.id === shownId;
            const playable = take.fileId !== null;
            const label = labels.get(take.id) ?? "Take";
            return (
              <li key={take.id} className="snap-start">
                <button
                  type="button"
                  aria-pressed={shown}
                  aria-disabled={!playable || undefined}
                  onClick={() => {
                    if (!playable) return;
                    onSelect(take.id === currentId ? null : take.id);
                  }}
                  className={cn(
                    "group flex flex-col gap-1.5 rounded-artwork text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus",
                    orientation === "portrait" ? "w-24" : "w-36",
                    !playable && "cursor-default",
                  )}
                >
                  <span
                    className={cn(
                      "relative flex w-full items-center justify-center overflow-hidden rounded-field transition-[box-shadow] duration-(--dur-fast)",
                      orientation === "portrait" ? "aspect-[9/16]" : "aspect-video",
                      take.posterFileId ? "bg-ground" : "bg-elevated",
                      shown
                        ? "ring-2 ring-accent ring-offset-2 ring-offset-ground"
                        : playable && "group-hover:ring-1 group-hover:ring-separator-opaque",
                    )}
                  >
                    {take.posterFileId ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a redirect to a presigned URL
                      <img
                        src={fileSrc(take.posterFileId)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className={cn(
                          "absolute inset-0 size-full object-contain",
                          take.status === "superseded" && "opacity-45",
                        )}
                      />
                    ) : take.status === "pending" ? (
                      <Loader
                        aria-hidden
                        className="size-5 animate-spin text-label-2 motion-reduce:animate-none"
                      />
                    ) : take.status === "failed" ? (
                      <TriangleAlert aria-hidden className="size-5 text-orange" />
                    ) : (
                      <Film aria-hidden className="size-5 text-label-3" />
                    )}
                  </span>
                  <span className="flex flex-col px-0.5">
                    <span className="text-callout font-medium text-label">{label}</span>
                    <span className="text-callout text-label-2">
                      {TAKE_STATUS_LABELS[take.status]}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
