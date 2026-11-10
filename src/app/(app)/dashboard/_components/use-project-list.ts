"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/ui";
import { loadMoreProjectsAction } from "../actions";
import type { ProjectSummary } from "../_lib/summary";

/** Client state for a paginated project list: load more, rename (moves to front), archive. */
export function useProjectList(initialItems: ProjectSummary[], initialCursor: string | null) {
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingMore, startLoadMore] = useTransition();

  function loadMore() {
    if (!cursor) return;
    startLoadMore(async () => {
      const result = await loadMoreProjectsAction(cursor);
      if (result.ok) {
        setItems((current) => {
          const known = new Set(current.map((p) => p.id));
          return [...current, ...result.items.filter((p) => !known.has(p.id))];
        });
        setCursor(result.nextCursor);
      } else {
        toast.danger("More projects could not be loaded", result.error);
      }
    });
  }

  function onRenamed(updated: ProjectSummary) {
    setItems((current) => [updated, ...current.filter((p) => p.id !== updated.id)]);
  }

  function onArchived(id: string) {
    setItems((current) => current.filter((p) => p.id !== id));
  }

  return { items, cursor, loadMore, loadingMore, onRenamed, onArchived };
}
