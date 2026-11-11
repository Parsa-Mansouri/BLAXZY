"use client";

import { useEffect, type ReactNode } from "react";
import { Button, PageHeader, Skeleton } from "@/ui";

/**
 * The quiet stand-in while a page loads: where the title, its rule and the content will be.
 * No text, no spinner; the real page replaces it as soon as it streams in.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col">
      <Skeleton className="h-12 w-72 max-w-full rounded-row" />
      <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-capsule bg-fill" />
      <Skeleton className="mt-3 h-5 w-96 max-w-full rounded-row" />
      <div className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-6">
        <Skeleton className="aspect-video" />
        <Skeleton className="aspect-video" />
        <Skeleton className="aspect-video" />
      </div>
    </div>
  );
}

/**
 * What a route shows when it fails unexpectedly: what happened in plain words, Try Again, and a
 * way out. The error is logged to the console; its details are never shown.
 */
export function RouteError({
  error,
  retry,
  heading = "h1",
  way,
}: {
  error: unknown;
  retry: () => void;
  heading?: "h1" | "h2";
  /** The way out besides Try Again, e.g. a link to Projects. */
  way?: ReactNode;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="flex flex-col">
      <PageHeader
        as={heading}
        title="Something Went Wrong"
        description="This page could not be shown. Try again; if it keeps failing, come back later."
      />
      <div className="flex in-2 flex-wrap items-center gap-3">
        <Button variant="primary" size="large" onClick={retry}>
          Try Again
        </Button>
        {way}
      </div>
    </section>
  );
}
