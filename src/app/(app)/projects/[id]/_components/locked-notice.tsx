"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useToast } from "@/ui";

function Notice({ stageLabel }: { stageLabel: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const toast = useToast();
  const locked = params.has("locked");
  const shown = useRef(false);

  useEffect(() => {
    if (!locked || shown.current) return;
    shown.current = true;
    toast.info(`Finish ${stageLabel} first.`);
    const rest = new URLSearchParams(params.toString());
    rest.delete("locked");
    const query = rest.toString();
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }, [locked, params, pathname, stageLabel, toast]);

  return null;
}

/**
 * A locked stage redirects to the current one with `?locked`. This says why, once, and takes the
 * flag out of the address.
 */
export function LockedNotice({ stageLabel }: { stageLabel: string }) {
  return (
    <Suspense fallback={null}>
      <Notice stageLabel={stageLabel} />
    </Suspense>
  );
}
