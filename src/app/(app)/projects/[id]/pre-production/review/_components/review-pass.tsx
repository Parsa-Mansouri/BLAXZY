"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronLeft } from "lucide-react";
import { fileSrc } from "@/lib/file-src";
import { Button, Skeleton } from "@/ui";
import { assetHref, type AssetKindKey } from "../../../_lib/asset-kinds";
import { loadReviewSheetAction, requestSheetChangesAction, type ReviewSheet } from "../actions";
import { RequestChangesSheet, type IssueChoice } from "./request-changes-sheet";
import { ReviewSummary } from "./review-summary";
import { refreshCredits } from "../../../../../_lib/credits";

export interface ReviewItem {
  id: string;
  name: string;
  kind: AssetKindKey;
  /** "character", "location"... */
  kindName: string;
}

/** The sheet of an asset, or null when the asset is no longer ready. */
type Loaded = ReviewSheet | null;

function capitalise(text: string): string {
  return text.replace(/^./, (c) => c.toUpperCase());
}

/** A pass through every ready asset's sheet, one at a time and large. */
export function ReviewPass({
  projectId,
  items: initialItems,
  firstSheet,
  issues,
  canContinue,
}: {
  projectId: string;
  items: ReviewItem[];
  firstSheet: ReviewSheet | null;
  issues: IssueChoice[];
  canContinue: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [index, setIndex] = useState(0);
  const [sheets, setSheets] = useState<Record<string, Loaded>>(
    initialItems[0] && firstSheet ? { [initialItems[0].id]: firstSheet } : {},
  );
  const [approved, setApproved] = useState<string[]>([]);
  const [sentBack, setSentBack] = useState<ReviewItem[]>([]);
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [loadError, setLoadError] = useState<string | null>(null);
  const requested = useRef(
    new Set<string>(initialItems[0] && firstSheet ? [initialItems[0].id] : []),
  );

  const total = items.length;
  const current = items[index] ?? null;
  const sheet = current ? sheets[current.id] : undefined;

  // Read the sheet on screen and the one after it, so Next is instant.
  useEffect(() => {
    for (const item of [items[index], items[index + 1]]) {
      if (!item || requested.current.has(item.id)) continue;
      requested.current.add(item.id);
      void loadReviewSheetAction(item.id).then((result) => {
        if (!result.ok) {
          requested.current.delete(item.id);
          setLoadError(result.error);
          return;
        }
        setLoadError(null);
        setSheets((map) => ({ ...map, [item.id]: result.data }));
        if (result.data) new Image().src = fileSrc(result.data.fileId);
      });
    }
  }, [items, index]);

  function go(delta: number) {
    setIndex((i) => Math.min(Math.max(i + delta, 0), total));
  }

  // Arrow keys move through the pass, unless a field or a sheet has the keyboard.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (changesOpen || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (event.key === "ArrowRight") setIndex((i) => Math.min(i + 1, items.length));
      else if (event.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changesOpen, items.length]);

  function looksGood() {
    if (!current) return;
    setApproved((list) => (list.includes(current.id) ? list : [...list, current.id]));
    go(1);
  }

  function requestChanges(input: { issueCodes: string[]; note: string }) {
    if (!current || !sheet) return;
    const leaving = current;
    setChangesError(null);
    startSending(async () => {
      const result = await requestSheetChangesAction(sheet.sheetId, input);
      if (!result.ok) {
        setChangesError(result.error);
        return;
      }
      setChangesOpen(false);
      refreshCredits();
      setApproved((list) => list.filter((id) => id !== leaving.id));
      setSentBack((list) => [...list, leaving]);
      setItems((list) => list.filter((item) => item.id !== leaving.id));
    });
  }

  if (!current || index >= total) {
    return (
      <ReviewSummary
        projectId={projectId}
        approved={approved.length}
        sentBack={sentBack}
        canContinue={canContinue}
        onBack={total > 0 ? () => setIndex(total - 1) : null}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Link
          href={`/projects/${projectId}/pre-production`}
          className="-ml-1.5 inline-flex w-fit items-center gap-0.5 rounded-control px-1.5 py-0.5 text-body text-label-2 focus-ring hover:text-label"
        >
          <ChevronLeft aria-hidden className="size-(--icon)" />
          Pre-production
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-large-title" aria-live="polite">
              {current.name}
            </h2>
            <p className="text-reading text-label-2">{capitalise(current.kindName)}</p>
          </div>
          <p className="text-title-2 text-label-2 tabular-nums" aria-live="polite">
            {index + 1} of {total}
          </p>
        </div>
      </header>

      <div className="relative aspect-video max-h-[70dvh] w-full overflow-hidden rounded-artwork bg-elevated">
        {sheet ? (
          // eslint-disable-next-line @next/next/no-img-element -- user media from object storage, sized by the frame
          <img
            key={sheet.fileId}
            src={fileSrc(sheet.fileId)}
            alt={`Reference sheet of ${current.name}`}
            decoding="async"
            className="absolute inset-0 size-full object-contain"
          />
        ) : sheet === null ? (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-body text-label">This asset is not ready anymore.</p>
            <Button variant="standard" render={<Link href={assetHref(projectId, current.id)} />}>
              Open {current.name}
            </Button>
          </div>
        ) : loadError ? (
          <p
            role="alert"
            className="flex size-full items-center justify-center p-6 text-callout text-red"
          >
            {loadError}
          </p>
        ) : (
          <Skeleton className="size-full rounded-none" />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <Button
            variant="plain"
            leadingIcon={<ArrowLeft aria-hidden />}
            onClick={() => go(-1)}
            disabled={index === 0}
          >
            Previous
          </Button>
          <Button variant="plain" trailingIcon={<ArrowRight aria-hidden />} onClick={() => go(1)}>
            {index === total - 1 ? "Summary" : "Next"}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setChangesOpen(true)} disabled={!sheet}>
            Request Changes
          </Button>
          <Button variant="prominent" onClick={looksGood} disabled={!sheet}>
            Looks Good
          </Button>
        </div>
      </div>
      <p className="hidden text-callout text-label-2 shell:block">
        Use the arrow keys to move between sheets.
      </p>

      <RequestChangesSheet
        open={changesOpen}
        onOpenChange={(open) => {
          setChangesOpen(open);
          if (!open) setChangesError(null);
        }}
        assetName={current.name}
        issues={issues}
        sending={sending}
        serverError={changesError}
        onSubmit={requestChanges}
      />
    </div>
  );
}
