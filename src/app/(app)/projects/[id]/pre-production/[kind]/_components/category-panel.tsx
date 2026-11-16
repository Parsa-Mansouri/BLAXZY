"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { DetectionPanel } from "@/server/assets";
import {
  Button,
  MenuItem,
  MenuSeparator,
  PageHeader,
  Skeleton,
  StatusLine,
  cn,
  stagger,
  useToast,
} from "@/ui";
import { ASSET_KIND_LABELS, categoryHref, type AssetKindKey } from "../../../_lib/asset-kinds";
import { pollDetectionPanel, refreshCards } from "@/app/(app)/_lib/poll-client";
import { usePolling } from "@/app/(app)/_lib/use-polling";
import { mergeLoadedPages, useServerSnapshot } from "@/app/(app)/_lib/use-server-snapshot";
import { isWorking } from "../../_components/asset-stage";
import { KIND_ASPECTS, type GalleryItem } from "../../_components/gallery-item";
import { FILL_PAGE } from "../../_lib/fill";
import { statusWords, type StageCounts } from "../../_lib/status-words";
import {
  aboutAsset,
  assetRef,
  categoryWarnings,
  type WarningFix,
} from "../../_lib/detection-review";
import { includeAssetAction, loadCardsAction, skipAssetsAction } from "../actions";
import { AddAssetSheet } from "./add-asset-sheet";
import { AssetCard } from "./asset-card";
import { RemoveAssetAlert, RenameAssetSheet } from "./asset-edits";
import { DetectionReviewSheet } from "./detection-review-sheet";
import { DetectionWarnings } from "./detection-warnings";
import { MergeAssets } from "./merge-assets";

interface Neighbour {
  kind: AssetKindKey;
  plural: string;
}

/** Grid columns by picture shape: wide pictures get wider cards. */
const GRID: Record<"video" | "portrait" | "square", string> = {
  portrait: "grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))]",
  square: "grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))]",
  video: "grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))]",
};

const ASPECT_CLASS = {
  portrait: "aspect-[4/5]",
  square: "aspect-square",
  video: "aspect-video",
} as const;

/** The detection review's state, as the screens poll it. */
export type ClientDetectionPanel = DetectionPanel;

/** One category: picture cards with their actions, Add, Merge, Load More and live status. */
export function CategoryPanel({
  projectId,
  kind,
  plural,
  initial,
  initialCursor,
  counts: initialCounts,
  panel: initialPanel,
  previous,
  next,
}: {
  projectId: string;
  kind: AssetKindKey;
  plural: string;
  initial: GalleryItem[];
  initialCursor: string | null;
  counts: StageCounts;
  /** The detected list's review state; null hides the review. */
  panel: ClientDetectionPanel | null;
  previous: Neighbour | null;
  next: Neighbour | null;
}) {
  const router = useRouter();
  const first = useMemo(
    () => ({ items: initial, cursor: initialCursor, counts: initialCounts }),
    [initial, initialCursor, initialCounts],
  );
  // A refresh brings page one again; pages loaded with Load More stay.
  const [{ items, cursor, counts }, setList] = useServerSnapshot(first, (current, fresh) => {
    const merged = mergeLoadedPages({
      current: current.items,
      currentCursor: current.cursor,
      fresh: fresh.items,
      freshCursor: fresh.cursor,
      id: (item) => item.id,
    });
    return { items: merged.items, cursor: merged.cursor, counts: fresh.counts };
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const loadingRef = useRef(false);

  const working = items.some((item) => isWorking(item.stage));
  usePolling(async (isActive, signal) => {
    if (loadingRef.current) return;
    const result = await refreshCards(projectId, kind, items.length, { signal });
    if (!isActive() || !result.ok || loadingRef.current) return;
    setList({
      items: result.data.items,
      cursor: result.data.nextCursor,
      counts: result.data.counts,
    });
  }, working);

  function more() {
    if (!cursor) return;
    setError(null);
    loadingRef.current = true;
    startLoading(async () => {
      try {
        const result = await loadCardsAction(projectId, kind, cursor);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setList((list) => ({
          items: [...list.items, ...result.data.items],
          cursor: result.data.nextCursor,
          counts: result.data.counts,
        }));
      } finally {
        loadingRef.current = false;
      }
    });
  }

  /* The detected list's review ("Something wrong with this list?"). */
  const [panel, setPanel] = useServerSnapshot(initialPanel, (_current, fresh) => fresh);
  const [review, setReview] = useState<{ open: boolean; note: string; key: number }>({
    open: false,
    note: "",
    key: 0,
  });
  const [edit, setEdit] = useState<{ type: "rename" | "remove"; item: GalleryItem } | null>(null);
  const [addPrefill, setAddPrefill] = useState<{ name: string; description: string } | null>(null);
  const [addKey, setAddKey] = useState(0);
  const [skippingId, setSkippingId] = useState<string | null>(null);
  const toast = useToast();

  const correcting = panel?.busy ?? false;
  usePolling(async (isActive, signal) => {
    const result = await pollDetectionPanel(projectId, { signal });
    if (!isActive() || !result.ok) return;
    setPanel(result.data);
    if (!result.data.busy) router.refresh();
  }, correcting);

  const warnings = useMemo(
    () => (panel ? categoryWarnings(panel.warnings, kind, items) : []),
    [panel, kind, items],
  );
  const listed = items.filter((item) => item.priority !== "skipped");
  const skippedItems = items.filter((item) => item.priority === "skipped");

  function openReview(note = "") {
    setReview((r) => ({ open: true, note, key: r.key + 1 }));
  }

  function openAdd(prefill: { name: string; description: string } | null) {
    setAddPrefill(prefill);
    setAddKey((k) => k + 1);
    setAddOpen(true);
  }

  function sent(result: { started: boolean }) {
    setReview((r) => ({ ...r, open: false }));
    if (result.started) setPanel((p) => (p ? { ...p, busy: true, failure: null } : p));
    router.refresh();
  }

  function skip(item: GalleryItem) {
    setSkippingId(item.id);
    void skipAssetsAction(projectId, [assetRef(item)]).then((result) => {
      setSkippingId(null);
      if (!result.ok) {
        toast.danger(result.error);
        return;
      }
      toast.success(`${item.name} skipped. It will not be designed.`);
      router.refresh();
    });
  }

  function include(item: GalleryItem) {
    setSkippingId(item.id);
    void includeAssetAction(projectId, item.id).then((result) => {
      setSkippingId(null);
      if (!result.ok) {
        toast.danger(result.error);
        return;
      }
      toast.success(`${item.name} is back in the list.`);
      router.refresh();
    });
  }

  function fixWarning(fix: WarningFix) {
    switch (fix.type) {
      case "review":
        openReview(fix.note);
        break;
      case "add":
        openAdd({ name: fix.name, description: fix.description });
        break;
      case "remove": {
        const item = items.find((i) => i.id === fix.assetId);
        if (item) setEdit({ type: "remove", item });
        break;
      }
    }
  }

  /** The card's menu: fixes to the detected list first, then Rename and Remove. */
  function menuFor(item: GalleryItem) {
    const skipped = item.priority === "skipped";
    return (
      <>
        {!skipped && panel ? (
          <MenuItem onClick={() => skip(item)} disabled={skippingId === item.id}>
            Not Needed as Its Own Asset
          </MenuItem>
        ) : null}
        {skipped ? (
          <MenuItem onClick={() => include(item)} disabled={skippingId === item.id}>
            Include It Again
          </MenuItem>
        ) : null}
        {panel && !skipped ? (
          <MenuItem disabled={correcting} onClick={() => openReview(aboutAsset(item))}>
            Something Is Wrong With This One…
          </MenuItem>
        ) : null}
        {panel ? <MenuSeparator /> : null}
        <MenuItem onClick={() => setEdit({ type: "rename", item })}>Rename…</MenuItem>
        <MenuItem destructive onClick={() => setEdit({ type: "remove", item })}>
          Remove…
        </MenuItem>
      </>
    );
  }

  const words = statusWords(counts);
  const aspect = KIND_ASPECTS[kind];
  const one = ASSET_KIND_LABELS.find((k) => k.kind === kind)?.one ?? "asset";
  const addLabel = `Add ${one.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase())}`;

  return (
    <div className={FILL_PAGE}>
      <PageHeader
        title={plural}
        description={
          <StatusLine tone={words.tone} className="tabular-nums">
            <span aria-live="polite">{words.text}</span>
          </StatusLine>
        }
        actions={
          items.length >= 2 ? (
            <Button variant="outlined" onClick={() => setMergeOpen(true)}>
              Merge
            </Button>
          ) : undefined
        }
      />

      {panel ? (
        <div className="mb-10 flex in-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button variant="outlined" onClick={() => openReview()} disabled={correcting}>
              Something Wrong With This List?
            </Button>
            <div aria-live="polite" className="min-w-0">
              {correcting ? (
                <StatusLine tone="working">Correcting the list</StatusLine>
              ) : panel.failure ? (
                <StatusLine tone="failed" srPrefix="Failed">
                  {panel.failure}
                </StatusLine>
              ) : null}
            </div>
          </div>
          {panel.suggestion && panel.rounds >= panel.maxRounds && !correcting ? (
            <p className="max-w-(--measure) text-secondary text-pretty text-label-2">
              {panel.suggestion}
            </p>
          ) : null}
          <DetectionWarnings warnings={warnings} disabled={correcting} onFix={fixWarning} />
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="mb-8 flex max-w-(--measure) in-2 flex-col gap-2">
          <h2 className="text-heading-sm text-balance">
            No {kind === "other" ? "other assets" : plural.toLowerCase()} yet
          </h2>
          <p className="text-body text-pretty text-label-2">
            Add the ones the script mentions and detection missed.
          </p>
        </div>
      ) : null}

      <ul className={cn("mb-16 grid in-2 gap-x-7 gap-y-10", GRID[aspect])}>
        {listed.map((item, i) => (
          <li key={item.id} className="min-w-0">
            <AssetCard
              projectId={projectId}
              item={item}
              menu={menuFor(item)}
              onSkip={panel ? () => skip(item) : undefined}
              skipping={skippingId === item.id}
              className="enter"
              style={stagger(Math.min(i, 12))}
            />
          </li>
        ))}
        <li className="min-w-0">
          <button
            type="button"
            onClick={() => openAdd(null)}
            className="flex w-full press enter flex-col gap-3 rounded-card text-left focus-ring"
            style={stagger(Math.min(listed.length, 12))}
          >
            <span
              className={cn(
                "flex w-full items-center justify-center rounded-card border border-dashed border-separator-opaque text-label-2 transition-colors duration-(--dur-press) hover:text-label",
                ASPECT_CLASS[aspect],
              )}
            >
              <Plus aria-hidden="true" strokeWidth={1.5} className="size-5" />
            </span>
            <span className="px-0.5 text-row font-semibold text-label-2">{addLabel}</span>
          </button>
        </li>
        {loading
          ? [0, 1].map((n) => (
              <li key={`loading-${n}`} aria-hidden="true" className="flex min-w-0 flex-col gap-3">
                <Skeleton className={cn("rounded-card", ASPECT_CLASS[aspect])} />
                <Skeleton className="h-5 w-2/3" />
              </li>
            ))
          : null}
      </ul>

      {cursor ? (
        <div className="mt-10">
          <Button variant="outlined" onClick={more} loading={loading}>
            Load More
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-secondary text-red">
          {error}
        </p>
      ) : null}

      {skippedItems.length > 0 ? (
        <section aria-labelledby="skipped-heading" className="mt-6 mb-16 flex in-3 flex-col gap-5">
          <div className="flex flex-col gap-1 border-t border-outline-quiet pt-6">
            <h2
              id="skipped-heading"
              className="font-mono text-meta tracking-caps text-label-2 uppercase"
            >
              Skipped
            </h2>
            <p className="text-secondary text-pretty text-label-3">
              Not designed. Shots describe them from the script instead.
            </p>
          </div>
          <ul className={cn("grid gap-x-7 gap-y-10", GRID[aspect])}>
            {skippedItems.map((item) => (
              <li key={item.id} className="min-w-0">
                <AssetCard projectId={projectId} item={item} menu={menuFor(item)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {previous || next ? (
        <nav
          aria-label="Categories"
          className="mt-auto flex in-3 items-center justify-between gap-4 pt-10"
        >
          {previous ? (
            <Link
              href={categoryHref(projectId, previous.kind)}
              className="inline-flex items-center gap-1 rounded-row py-2 text-body font-medium text-label-2 focus-ring hover:text-label"
            >
              <ChevronLeft aria-hidden="true" strokeWidth={1.5} className="size-(--icon)" />
              {previous.plural}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={categoryHref(projectId, next.kind)}
              className="inline-flex items-center gap-1 rounded-row py-2 text-body font-medium text-label-2 focus-ring hover:text-label"
            >
              {next.plural}
              <ChevronRight aria-hidden="true" strokeWidth={1.5} className="size-(--icon)" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <AddAssetSheet
        key={`add-${addKey}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        projectId={projectId}
        kind={kind}
        prefill={addPrefill ?? undefined}
        onAdded={() => router.refresh()}
      />
      {panel ? (
        <DetectionReviewSheet
          key={`review-${review.key}`}
          open={review.open}
          onOpenChange={(open) => setReview((r) => ({ ...r, open }))}
          projectId={projectId}
          initialNote={review.note}
          onSent={sent}
        />
      ) : null}
      {edit?.type === "rename" ? (
        <RenameAssetSheet
          projectId={projectId}
          item={edit.item}
          onClose={() => setEdit(null)}
          onDone={() => router.refresh()}
        />
      ) : null}
      {edit?.type === "remove" ? (
        <RemoveAssetAlert
          projectId={projectId}
          item={edit.item}
          onClose={() => setEdit(null)}
          onDone={() => router.refresh()}
        />
      ) : null}
      <MergeAssets
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        projectId={projectId}
        items={items}
        onMerged={() => router.refresh()}
      />
    </div>
  );
}
