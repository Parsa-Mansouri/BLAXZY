"use client";

import Link from "next/link";
import { Button } from "@/ui";
import { RouteError } from "./route-states";
import { Wordmark } from "./wordmark";

/**
 * An unexpected failure outside the signed-in window (landing, sign-in pages, the root layout):
 * laid out like the root not-found page, with the wordmark and a way back to the start.
 */
export function StandaloneError({
  error,
  retry,
  home = "/",
  homeLabel = "Home",
}: {
  error: unknown;
  retry: () => void;
  home?: string;
  homeLabel?: string;
}) {
  return (
    <main className="flex min-h-dvh w-full flex-col items-start gap-16 px-(--content-x) pt-[clamp(2.5rem,13vh,8rem)] pb-18">
      <Wordmark />
      <RouteError
        error={error}
        retry={retry}
        way={
          <Button variant="outlined" size="large" render={<Link href={home} />}>
            {homeLabel}
          </Button>
        }
      />
    </main>
  );
}
