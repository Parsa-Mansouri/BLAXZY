"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { FinishedAssetEvent } from "@/server/assets";
import { fileSrc } from "@/lib/file-src";
import { useToast } from "@/ui";
import { pollFinishedAction } from "../_lib/finished-actions";
import { usePolling } from "../_lib/use-polling";
import { assetHref } from "../projects/[id]/_lib/asset-kinds";

const POLL_MS = 4500;
const STORAGE_KEY = "blaxzy.finished-cursor";
/** A cursor kept across a reload is used only when the last poll was this recent. */
const STORED_CURSOR_MAX_AGE_MS = 10 * 60 * 1000;
const MAX_REMEMBERED_EVENTS = 200;

function readStoredCursor(): string | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null) return null;
    const { cursor, savedAt } = stored as { cursor?: unknown; savedAt?: unknown };
    if (typeof cursor !== "string" || typeof savedAt !== "number") return null;
    return Date.now() - savedAt <= STORED_CURSOR_MAX_AGE_MS ? cursor : null;
  } catch {
    return null;
  }
}

function storeCursor(cursor: string) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ cursor, savedAt: Date.now() }));
  } catch {
    // Without storage, a reload only loses what finished in between.
  }
}

/** "Ines's image is ready" / "Couldn't make Ines's sheet". */
export function finishedTitle(event: Pick<FinishedAssetEvent, "what" | "ready" | "assetName">) {
  const thing = `${event.assetName}'s ${event.what === "look" ? "image" : "sheet"}`;
  return event.ready ? `${thing} is ready` : `Couldn't make ${thing}`;
}

/**
 * Tells the user, on any page, when an asset's image or sheet has been made (a large toast with
 * the picture) or could not be made (a small one). Either opens the asset, where they review it
 * or try again. Nothing is shown for the asset whose page is open: it shows there.
 *
 * Mounted once in the app shell, so it lives through client navigation. It only shows toasts;
 * each page keeps its own data current.
 */
export function FinishedWatcher() {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const cursor = useRef<string | null>(null);
  const started = useRef(false);
  const seen = useRef(new Set<string>());
  /** Toast id to the page it opens, for the toasts shown so far. */
  const shown = useRef(new Map<string, string>());
  const page = useRef(pathname);

  const announce = useCallback(
    (event: FinishedAssetEvent) => {
      const href = assetHref(event.projectId, event.assetId);
      const elsewhere = !page.current.startsWith(`/projects/${event.projectId}/`);
      const place = elsewhere ? `In ${event.projectTitle}` : undefined;
      const open = () => router.push(href);
      shown.current.set(event.id, href);
      if (event.ready && event.fileId) {
        toast.show({
          id: event.id,
          kind: "success",
          title: finishedTitle(event),
          description: place,
          media: { src: fileSrc(event.fileId), alt: event.assetName, aspect: event.orientation },
          href,
          onOpen: open,
          persistent: true,
        });
      } else if (!event.ready) {
        toast.show({
          id: event.id,
          kind: "danger",
          title: finishedTitle(event),
          description: place ? `${place}. Open it to try again.` : "Open it to try again.",
          href,
          onOpen: open,
        });
      }
    },
    [router, toast],
  );

  const poll = useCallback(async () => {
    if (!started.current) {
      started.current = true;
      cursor.current = readStoredCursor();
    }
    const result = await pollFinishedAction(cursor.current);
    if (!result) return;
    cursor.current = result.cursor;
    storeCursor(result.cursor);
    for (const event of result.events) {
      if (seen.current.has(event.id)) continue;
      seen.current.add(event.id);
      if (page.current === assetHref(event.projectId, event.assetId)) continue;
      announce(event);
    }
    if (seen.current.size > MAX_REMEMBERED_EVENTS) {
      seen.current = new Set([...seen.current].slice(-MAX_REMEMBERED_EVENTS / 2));
      for (const id of shown.current.keys()) if (!seen.current.has(id)) shown.current.delete(id);
    }
  }, [announce]);

  usePolling(poll, true, POLL_MS, true);

  // Arriving on an asset's page puts away its toasts: the page shows the result itself.
  useEffect(() => {
    page.current = pathname;
    for (const [id, href] of shown.current) {
      if (href !== pathname) continue;
      toast.dismiss(id);
      shown.current.delete(id);
    }
  }, [pathname, toast]);

  return null;
}
