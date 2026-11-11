"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, PageHeader, StatusLine, cn, stagger } from "@/ui";
import { ASSET_KIND_LABELS, categoryHref, type AssetKindKey } from "../../../_lib/asset-kinds";
import { usePolling } from "../../../_lib/use-polling";
import { isWorking } from "../../_components/asset-stage";
import { KIND_ASPECTS, type GalleryItem } from "../../_components/gallery-item";
import { FILL_PAGE } from "../../_lib/fill";
import { statusWords, type StageCounts } from "../../_lib/status-words";
import { loadCardsAction, refreshCardsAction } from "../actions";
import { AddAssetSheet } from "./add-asset-sheet";
import { AssetCard } from "./asset-card";
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

/** One category: picture cards with their actions, Add, Merge, Load More and live status. */
export function CategoryPanel({
  projectId,
  kind,
  plural,
  initial,
  initialCursor,
  counts: initialCounts,
  previous,
  next,
}: {
  projectId: string;
  kind: AssetKindKey;
  plural: string;
  initial: GalleryItem[];
  initialCursor: string | null;
  counts: StageCounts;
  previous: Neighbour | null;
  next: Neighbour | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [counts, setCounts] = useState(initialCounts);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const loadingRef = useRef(false);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setItems(initial);
    setCursor(initialCursor);
    setCounts(initialCounts);
  }

  const working = items.some((item) => isWorking(item.stage));
  usePolling(async (isActive) => {
    if (loadingRef.current) return;
    const result = await refreshCardsAction(projectId, kind, items.length);
    if (!isActive() || !result.ok || loadingRef.current) return;
    setItems(result.data.items);
    setCursor(result.data.nextCursor);
    setCounts(result.data.counts);
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
        setItems((list) => [...list, ...result.data.items]);
        setCursor(result.data.nextCursor);
        setCounts(result.data.counts);
      } finally {
        loadingRef.current = false;
      }
    });
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
          <StatusLine tone={words.tone}>
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

      <ul className={cn("mb-16 grid in-2 gap-x-7 gap-y-10", GRID[aspect])}>
        {items.map((item, i) => (
          <li key={item.id} className="min-w-0">
            <AssetCard
              projectId={projectId}
              item={item}
              className="enter"
              style={stagger(Math.min(i, 12))}
            />
          </li>
        ))}
        <li className="min-w-0">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex w-full press enter flex-col gap-3 rounded-card text-left focus-ring"
            style={stagger(Math.min(items.length, 12))}
          >
            <span
              className={cn(
                "flex w-full items-center justify-center rounded-card border border-dashed border-separator-opaque text-label-2 transition-colors duration-(--dur-press) hover:text-label",
                ASPECT_CLASS[aspect],
              )}
            >
              <Plus aria-hidden="true" strokeWidth={1.4} className="size-6" />
            </span>
            <span className="px-0.5 text-row font-semibold tracking-[-0.01em] text-label-2">
              {addLabel}
            </span>
          </button>
        </li>
      </ul>

      {cursor ? (
        <div className="mt-10">
          <Button onClick={more} loading={loading}>
            Load More
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-secondary text-red">
          {error}
        </p>
      ) : null}

      {previous || next ? (
        <nav
          aria-label="Categories"
          className="mt-auto flex in-3 items-center justify-between gap-4 pt-6 hairline-t"
        >
          {previous ? (
            <Link
              href={categoryHref(projectId, previous.kind)}
              className="inline-flex items-center gap-1 rounded-row py-2 text-body font-medium text-label-2 focus-ring hover:text-label"
            >
              <ChevronLeft aria-hidden="true" className="size-(--icon)" />
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
              <ChevronRight aria-hidden="true" className="size-(--icon)" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <AddAssetSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        projectId={projectId}
        kind={kind}
        onAdded={() => router.refresh()}
      />
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
