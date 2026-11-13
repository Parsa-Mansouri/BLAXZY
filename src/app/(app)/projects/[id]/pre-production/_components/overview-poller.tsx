"use client";

import { useRouter } from "next/navigation";
import { usePolling } from "@/app/(app)/_lib/use-polling";
import { pollOverviewAction } from "./overview-actions";

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
  usePolling(async (isActive) => {
    const next = await pollOverviewAction(projectId);
    if (isActive() && next && next.signature !== signature) router.refresh();
  }, busy);
  return null;
}
