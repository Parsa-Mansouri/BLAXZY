import type { ReactNode } from "react";
import { Skeleton, cn } from "@/ui";
import { CONTROLS_BOX, FRAME_BOX, FRAME_HEIGHT } from "./frame";
import { FillPage } from "./fill-page";
import { POSTER_SHAPES } from "./poster-tile";

/**
 * The stand-ins the Production routes show while they load, each shaped like its screen: grey
 * shapes where the title, the status line and the content will be. No words, no spinner.
 */

/** Where the page title, its rule and the status line will be. */
export function HeaderSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="mb-8 flex flex-col">
      <Skeleton className={cn("h-12 max-w-full rounded-row", wide ? "w-96" : "w-56")} />
      <div aria-hidden className="mt-3 h-[3px] w-12 rounded-capsule bg-fill" />
      <Skeleton className="mt-3 h-4 w-64 max-w-full rounded-paper" />
    </div>
  );
}

/** A loading Production screen: announced once, as "Loading". */
export function LoadingPage({ children }: { children: ReactNode }) {
  return (
    <FillPage>
      <div role="status" aria-label="Loading" className="flex flex-1 flex-col">
        {children}
      </div>
    </FillPage>
  );
}

/** A poster grid of a few cards (the clips board, the finished shelf). */
export function PosterGridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-x-7 gap-y-10">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-3">
          <Skeleton className={cn("w-full rounded-card", POSTER_SHAPES.landscape)} />
          <Skeleton className="h-5 w-2/3 rounded-paper" />
          <Skeleton className="h-4 w-1/3 rounded-paper" />
        </div>
      ))}
    </div>
  );
}

/** The shots in story order on the Shots screen. */
export function ShotRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-5 px-3.5 py-3">
          <Skeleton className="h-4 w-6 rounded-paper" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-5 w-full max-w-80 rounded-paper" />
            <Skeleton className="h-4 w-16 rounded-paper" />
          </div>
          <Skeleton className="h-10 w-16 rounded-paper max-sm:hidden" />
          <Skeleton className="h-4 w-28 rounded-paper max-sm:hidden" />
        </div>
      ))}
    </div>
  );
}

/** The title and status line of the shot in a review's focus area, with its decision buttons. */
export function FocusHeaderSkeleton({ buttons = 2 }: { buttons?: number }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-col gap-2">
        <Skeleton className="h-8 w-72 max-w-full rounded-row" />
        <Skeleton className="h-4 w-48 rounded-paper" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: buttons }, (_, i) => (
          <Skeleton key={i} className="h-(--btn-lg) w-36 rounded-capsule" />
        ))}
      </div>
    </div>
  );
}

/** The clip's frame and its control bar, at the size the player takes. */
export function PlayerSkeleton() {
  return (
    <div className={cn("flex flex-col gap-2", FRAME_HEIGHT)}>
      <Skeleton className={cn("rounded-card", FRAME_BOX.landscape)} />
      <Skeleton className={cn("h-11 rounded-capsule", CONTROLS_BOX.landscape)} />
    </div>
  );
}
