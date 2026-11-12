"use client";

import { useEffect, type ReactNode } from "react";
import {
  Button,
  PageHeader,
  SkeletonHeader,
  SkeletonRegion,
  SkeletonRows,
  Skeleton,
  SkeletonTile,
  stagger,
} from "@/ui";

/**
 * The quiet stand-in while a library page loads (Home, Projects, Account): the page header,
 * then a grid of film tiles, sized like the real page. No text, no spinner; the real page
 * replaces it as soon as it streams in.
 */
export function PageSkeleton() {
  return (
    <SkeletonRegion>
      <SkeletonHeader />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-6 gap-y-9">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonTile key={i} status className="enter" style={stagger(i, 0)} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

/**
 * The stand-in while a page inside a project loads: the page header, then the list on the left
 * and the focus area on the right filling the height, as most stage pages are laid out.
 */
export function StageSkeleton() {
  return (
    <SkeletonRegion className="flex-1">
      <SkeletonHeader />
      <div className="flex min-h-0 flex-1 flex-wrap items-stretch gap-x-20 gap-y-10">
        <SkeletonRows rows={5} className="flex-[1_1_260px] self-start sm:max-w-80" />
        <div className="flex min-h-80 min-w-0 flex-[999_1_380px] flex-col gap-6">
          <Skeleton className="h-9 w-2/3 max-w-140 rounded-row" />
          <Skeleton className="min-h-60 flex-1 rounded-tile" />
          <Skeleton className="h-(--btn-lg) w-40 rounded-capsule" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

/**
 * What a route shows when it fails unexpectedly: what could not be shown, Try Again, and a way
 * out. The error is logged to the console; its details are never shown.
 */
export function RouteError({
  error,
  retry,
  heading = "h1",
  title = "This Page Could Not Be Shown",
  message = "Try again. If it keeps failing, come back in a few minutes.",
  way,
}: {
  error: unknown;
  retry: () => void;
  heading?: "h1" | "h2";
  /** What could not be shown, specifically: "This Page Could Not Be Shown". */
  title?: string;
  /** One sentence on what to do. */
  message?: string;
  /** The way out besides Try Again, e.g. a link to Projects. */
  way?: ReactNode;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="flex flex-col">
      <PageHeader as={heading} title={title} description={message} />
      <div className="flex in-2 flex-wrap items-center gap-3">
        <Button variant="primary" size="large" onClick={retry}>
          Try Again
        </Button>
        {way}
      </div>
    </section>
  );
}
