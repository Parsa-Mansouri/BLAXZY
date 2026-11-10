"use client";

import { Button, Hint } from "@/ui";
import type { ProjectSummary } from "../_lib/summary";
import { ProjectTile } from "./project-tile";

/** The shelf: a grid of title cards that fills the width, with Load More under it. */
export function ProjectGrid({
  items,
  hasMore,
  loadingMore,
  onLoadMore,
  onRenamed,
  onArchived,
  archivedNote = false,
}: {
  items: ProjectSummary[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRenamed: (project: ProjectSummary) => void;
  onArchived: (id: string) => void;
  /** Footnote that archived projects are left out (All Projects only). */
  archivedNote?: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,--spacing(70)),1fr))] gap-x-5 gap-y-7">
        {items.map((project) => (
          <ProjectTile
            key={project.id}
            project={project}
            onRenamed={onRenamed}
            onArchived={onArchived}
          />
        ))}
      </ul>
      {hasMore ? (
        <div>
          <Button variant="standard" onClick={onLoadMore} loading={loadingMore}>
            Load More
          </Button>
        </div>
      ) : archivedNote ? (
        <Hint>Archived projects are not shown.</Hint>
      ) : null}
    </div>
  );
}
