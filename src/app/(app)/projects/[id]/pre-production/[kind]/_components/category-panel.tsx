"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, GitMerge, Plus } from "lucide-react";
import { Button, ProgressBar } from "@/ui";
import { categoryHref, readyWords, type AssetKindKey } from "../../../_lib/asset-kinds";
import { usePolling } from "../../../_lib/use-polling";
import { AssetGallery, type GalleryItem } from "../../_components/asset-gallery";
import { isWorking } from "../../_components/asset-stage";
import { loadCardsAction, refreshCardsAction } from "../actions";
import { AddAssetSheet } from "./add-asset-sheet";
import { MergeAssets } from "./merge-assets";

interface Neighbour {
  kind: AssetKindKey;
  plural: string;
}

/** One category: the asset tiles, with Add, Merge, Load More and live progress. */
export function CategoryPanel({
  projectId,
  kind,
  plural,
  initial,
  initialCursor,
  total: initialTotal,
  ready: initialReady,
  previous,
  next,
}: {
  projectId: string;
  kind: AssetKindKey;
  plural: string;
  initial: GalleryItem[];
  initialCursor: string | null;
  total: number;
  ready: number;
  previous: Neighbour | null;
  next: Neighbour | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [counts, setCounts] = useState({ total: initialTotal, ready: initialReady });
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
    setCounts({ total: initialTotal, ready: initialReady });
  }

  const working = items.some((item) => isWorking(item.stage));
  usePolling(async () => {
    if (loadingRef.current) return;
    const result = await refreshCardsAction(projectId, kind, items.length);
    if (!result.ok || loadingRef.current) return;
    setItems(result.data.items);
    setCursor(result.data.nextCursor);
    setCounts({ total: result.data.total, ready: result.data.ready });
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
        setCounts({ total: result.data.total, ready: result.data.ready });
      } finally {
        loadingRef.current = false;
      }
    });
  }

  const words = readyWords(counts.ready, counts.total);
  const percent = counts.total === 0 ? 0 : (counts.ready / counts.total) * 100;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-5">
        <Link
          href={`/projects/${projectId}/pre-production`}
          className="-ml-1.5 inline-flex w-fit items-center gap-0.5 rounded-control px-1.5 py-0.5 text-body text-label-2 focus-ring hover:text-label"
        >
          <ChevronLeft aria-hidden className="size-(--icon)" />
          Pre-production
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="text-large-title">{plural}</h2>
            <p className="text-reading text-label-2 tabular-nums" aria-live="polite">
              {words}
            </p>
            <ProgressBar
              value={percent}
              tone={counts.total > 0 && counts.ready === counts.total ? "success" : "default"}
              aria-label={`${plural}: ${words}`}
              className="w-56"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              leadingIcon={<GitMerge aria-hidden />}
              onClick={() => setMergeOpen(true)}
              disabled={items.length < 2}
            >
              Merge
            </Button>
            <Button leadingIcon={<Plus aria-hidden />} onClick={() => setAddOpen(true)}>
              Add
            </Button>
          </div>
        </div>
      </header>

      <AssetGallery projectId={projectId} items={items} />

      {cursor ? (
        <div>
          <Button onClick={more} loading={loading}>
            Load More
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-callout text-red">
          {error}
        </p>
      ) : null}

      {previous || next ? (
        <nav
          aria-label="Categories"
          className="flex items-center justify-between gap-4 pt-4 hairline-t"
        >
          {previous ? (
            <Link
              href={categoryHref(projectId, previous.kind)}
              className="inline-flex items-center gap-1 rounded-control py-2 text-body text-label focus-ring hover:text-label-2"
            >
              <ChevronLeft aria-hidden className="size-(--icon)" />
              <span className="flex flex-col">
                <span className="text-callout text-label-2">Previous</span>
                {previous.plural}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={categoryHref(projectId, next.kind)}
              className="inline-flex items-center gap-1 rounded-control py-2 text-right text-body text-label focus-ring hover:text-label-2"
            >
              <span className="flex flex-col">
                <span className="text-callout text-label-2">Next</span>
                {next.plural}
              </span>
              <ChevronRight aria-hidden className="size-(--icon)" />
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
