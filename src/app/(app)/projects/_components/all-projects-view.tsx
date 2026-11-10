"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button, Hint, Toolbar } from "@/ui";
import type { ProjectSummary } from "../../dashboard/_lib/summary";
import { NewProjectDialog } from "../../dashboard/_components/new-project-dialog";
import { ProjectGrid } from "../../dashboard/_components/project-grid";
import { useProjectList } from "../../dashboard/_components/use-project-list";

/** Every project in the library, most recently updated first. */
export function AllProjectsView({
  initialItems,
  initialCursor,
}: {
  initialItems: ProjectSummary[];
  initialCursor: string | null;
}) {
  const list = useProjectList(initialItems, initialCursor);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Toolbar
        title="All Projects"
        trailing={
          <Button variant="prominent" leadingIcon={<Plus />} onClick={() => setCreating(true)}>
            New Project
          </Button>
        }
      />
      <div className="px-(--content-x) pt-2 pb-16">
        {list.items.length > 0 ? (
          <ProjectGrid
            items={list.items}
            hasMore={Boolean(list.cursor)}
            loadingMore={list.loadingMore}
            onLoadMore={list.loadMore}
            onRenamed={list.onRenamed}
            onArchived={list.onArchived}
            archivedNote
          />
        ) : (
          <Hint className="pt-6">
            There are no projects yet. Create one here or from{" "}
            <Link href="/dashboard" className="text-label underline focus-ring">
              Home
            </Link>
            .
          </Hint>
        )}
      </div>
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
