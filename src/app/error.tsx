"use client";

import { StandaloneError } from "./_components/standalone-error";

/** An unexpected failure on a page outside the signed-in window (the landing page). */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return <StandaloneError error={error} retry={retry} />;
}
