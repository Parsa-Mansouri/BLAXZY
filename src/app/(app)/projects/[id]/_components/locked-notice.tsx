"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useToast } from "@/ui";
import { NOTICE_FLAG, routeNotice } from "../_lib/route-notices";

const LOCKED_FLAG = "locked";

function Notice({ stageLabel }: { stageLabel: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const toast = useToast();
  const locked = params.has(LOCKED_FLAG);
  const notice = routeNotice(params.get(NOTICE_FLAG));
  const flagged = locked || params.has(NOTICE_FLAG);
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!flagged) return;
    const key = `${pathname}?${params.toString()}`;
    if (shown.current === key) return;
    shown.current = key;
    if (locked) toast.info(`Finish ${stageLabel} first.`);
    else if (notice) toast.info(notice);
    const rest = new URLSearchParams(params.toString());
    rest.delete(LOCKED_FLAG);
    rest.delete(NOTICE_FLAG);
    const query = rest.toString();
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }, [flagged, locked, notice, params, pathname, stageLabel, toast]);

  return null;
}

/**
 * A redirect inside a project adds a flag: `?locked` from a locked stage, `?notice=<key>` from a
 * screen that is not open yet. This says why, once, and takes the flag out of the address.
 */
export function LockedNotice({ stageLabel }: { stageLabel: string }) {
  return (
    <Suspense fallback={null}>
      <Notice stageLabel={stageLabel} />
    </Suspense>
  );
}
