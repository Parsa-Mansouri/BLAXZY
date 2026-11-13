"use client";

import { useRouter } from "next/navigation";
import { usePolling } from "@/app/(app)/_lib/use-polling";
import { pollOverview } from "@/app/(app)/_lib/poll-client";

/** Refreshes the overview when its progress or images change; polls only while work is running. */
export function OverviewPoller({
  projectId,
  busy,
  signature,
}: {
  projectId: string;
  busy: boolean;
  signature: string;
}) {
  const router = useRouter();
  usePolling(async (isActive, signal) => {
    const next = await pollOverview(projectId, { signal });
    if (isActive() && next && next.signature !== signature) router.refresh();
  }, busy);
  return null;
}
