"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, PageHeader, Tabs, Toolbar } from "@/ui";
import type { ProjectSummary } from "../../dashboard/_lib/summary";
import { ProjectGrid } from "../../dashboard/_components/project-grid";
import { useProjectList } from "../../dashboard/_components/use-project-list";

type Filter = "all" | "progress" | "finished";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "progress", label: "In Progress" },
  { value: "finished", label: "Finished" },
];

const EMPTY: Record<Filter, { title: string; text: string }> = {
  all: { title: "No films yet", text: "Each film you start appears here, with its stage." },
  progress: { title: "No films in progress", text: "Every film you started is finished." },
  finished: {
    title: "No finished films yet",
    text: "A film appears here once its production is complete.",
  },
};

/** Every project in the library, most recently updated first, with the All / In Progress / Finished filter. */
export function AllProjectsView({
  initialItems,
  initialCursor,
}: {
  initialItems: ProjectSummary[];
  initialCursor: string | null;
}) {
  const list = useProjectList(initialItems, initialCursor);
  const [filter, setFilter] = useState<Filter>("all");

  function shown(value: Filter): ProjectSummary[] {
    if (value === "all") return list.items;
    return list.items.filter((p) => (p.stage === "done") === (value === "finished"));
  }

  return (
    <>
      <Toolbar />
      <div className="flex flex-1 flex-col px-(--content-x) pt-8 pb-18">
        <PageHeader
          title="Projects"
          description="Every film you have started."
          actions={
            <Button variant="primary" size="large" render={<Link href="/projects/new" />}>
              New Project
            </Button>
          }
        />
        <Tabs
          aria-label="Filter projects"
          tabs={FILTERS}
          value={filter}
          onValueChange={(next) => setFilter(next as Filter)}
          className="flex flex-1 in-2 flex-col"
        >
          {(value) => {
            const items = shown(value as Filter);
            const hasMore = Boolean(list.cursor);
            if (items.length === 0 && !hasMore) {
              const empty = EMPTY[value as Filter];
              return (
                <div className="flex flex-1 flex-col justify-center py-10">
                  <div className="flex max-w-(--measure) flex-col items-start gap-2">
                    <p className="text-heading-sm text-balance">{empty.title}</p>
                    <p className="text-body text-pretty text-label-2">{empty.text}</p>
                    {value === "finished" ? (
                      <Button
                        variant="outlined"
                        className="mt-6"
                        onClick={() => setFilter("progress")}
                      >
                        Show In Progress
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            }
            return (
              <ProjectGrid
                items={items}
                hasMore={hasMore}
                loadingMore={list.loadingMore}
                onLoadMore={list.loadMore}
                onRenamed={list.onRenamed}
                onArchived={list.onArchived}
                baseDelay={40}
                archivedNote
              />
            );
          }}
        </Tabs>
      </div>
    </>
  );
}
