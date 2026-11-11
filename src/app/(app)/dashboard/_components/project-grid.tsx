"use client";

import { Button } from "@/ui";
import type { ProjectSummary } from "../_lib/summary";
import { ProjectTile } from "./project-tile";

/** The shelf: a grid of film tiles that fills the width, with Load More under it. */
export function ProjectGrid({
  items,
  hasMore,
  loadingMore,
  onLoadMore,
  onRenamed,
  onArchived,
  baseDelay = 300,
  archivedNote = false,
}: {
  items: ProjectSummary[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRenamed: (project: ProjectSummary) => void;
  onArchived: (id: string) => void;
  /** Delay (ms) of the first tile's entrance; later tiles follow in 40ms steps. */
  baseDelay?: number;
  /** Quiet note that archived projects are left out (Projects page only). */
  archivedNote?: boolean;
}) {
  return (
    <div className="flex flex-col gap-10">
      {items.length > 0 ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-x-6 gap-y-9">
          {items.map((project, index) => (
            <ProjectTile
              key={project.id}
              project={project}
              index={index}
              baseDelay={baseDelay}
              onRenamed={onRenamed}
              onArchived={onArchived}
            />
          ))}
        </ul>
      ) : null}
      {hasMore ? (
        <div>
          <Button variant="outlined" onClick={onLoadMore} loading={loadingMore}>
            Load More
          </Button>
        </div>
      ) : archivedNote && items.length > 0 ? (
        <p className="text-secondary text-label-2">Archived projects are not shown.</p>
      ) : null}
    </div>
  );
}
