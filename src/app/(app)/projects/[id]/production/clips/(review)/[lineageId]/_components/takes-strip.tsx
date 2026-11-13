"use client";

import type { TakeView } from "@/server/production";
import { fileSrc } from "@/lib/file-src";
import { cn, stagger, StoredImage } from "@/ui";
import { TAKE_STATUS_LABELS, type Orientation } from "../../../_lib/clip-view";

/** The empty frame's few words; never a fake picture. */
function emptyWords(status: TakeView["status"]): string {
  if (status === "pending") return "Rendering";
  if (status === "failed") return "Failed";
  return "No poster";
}

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
    <section aria-labelledby="takes-title" className="flex flex-col gap-4">
      <h3 id="takes-title" className="text-section">
        Takes
      </h3>
      {takes.length === 0 ? (
        <p className="text-body text-label-2">Every draft and final of this shot is kept here.</p>
      ) : (
        <ul className="-mx-2 flex snap-x gap-3 overflow-x-auto px-2 pt-1 pb-3">
          {takes.map((take, i) => {
            const shown = take.id === shownId;
            const playable = take.fileId !== null;
            const label = labels.get(take.id) ?? "Take";
            return (
              <li key={take.id} className="enter snap-start" style={stagger(Math.min(i, 8), 60)}>
                <button
                  type="button"
                  aria-pressed={shown}
                  aria-disabled={!playable || undefined}
                  onClick={() => {
                    if (!playable) return;
                    onSelect(take.id === currentId ? null : take.id);
                  }}
                  className={cn(
                    "group flex press flex-col gap-2 rounded-tile text-left focus-ring outline-offset-4",
                    orientation === "portrait" ? "w-24" : "w-40",
                    !playable && "cursor-default",
                  )}
                >
                  <span
                    className={cn(
                      "relative flex w-full items-center justify-center overflow-hidden rounded-tile transition-[box-shadow] duration-(--dur-press) ease-out",
                      orientation === "portrait" ? "aspect-[9/16]" : "aspect-video",
                      take.posterFileId ? "bg-ground" : "bg-elevated",
                      shown
                        ? "ring-2 ring-brand ring-offset-2 ring-offset-ground"
                        : playable && "group-hover:ring-1 group-hover:ring-outline",
                    )}
                  >
                    {take.posterFileId ? (
                      <StoredImage
                        src={fileSrc(take.posterFileId)}
                        alt=""
                        className={cn(
                          "absolute inset-0 size-full object-contain",
                          take.status === "superseded" && "opacity-45",
                        )}
                      />
                    ) : (
                      <span className="p-2 text-center text-meta text-label-3">
                        {emptyWords(take.status)}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col px-0.5">
                    <span className="text-secondary font-medium text-label">{label}</span>
                    <span className="text-meta text-label-2">
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
