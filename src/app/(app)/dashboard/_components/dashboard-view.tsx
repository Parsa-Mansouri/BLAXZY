"use client";

import { useRef, useState, useTransition } from "react";
import { Clapperboard, Plus } from "lucide-react";
import { PROJECT_STAGES } from "@/lib/stages";
import { Button, CoachMark, EmptyState, Hint, useDismissed, useToast } from "@/ui";
import { loadMoreProjectsAction } from "../actions";
import type { ProjectSummary } from "../_lib/summary";
import { NewProjectDialog } from "./new-project-dialog";
import { ProjectCard } from "./project-card";

export function DashboardView({
  firstName,
  initialItems,
  initialCursor,
}: {
  firstName: string;
  initialItems: ProjectSummary[];
  initialCursor: string | null;
}) {
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [creating, setCreating] = useState(false);
  const [loadingMore, startLoadMore] = useTransition();
  const startButton = useRef<HTMLElement>(null);
  const coach = useDismissed("dashboard-start-project");

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
        toast.danger("Could not load more projects", result.error);
      }
    });
  }

  const startAction = (
    <Button
      ref={startButton}
      size="lg"
      variant="primary"
      leadingIcon={<Plus />}
      onClick={() => setCreating(true)}
    >
      Start a project
    </Button>
  );

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome, {firstName}</h1>
          <p className="text-fg-muted">
            {items.length === 0 ? "Ready to make your first film?" : "Pick up where you left off."}
          </p>
        </div>
        {startAction}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Clapperboard />}
          title="Your first film starts here"
          description="Tell us what to call it and we will guide you through four steps."
          action={
            <div className="flex flex-col items-center gap-5">
              <ol className="flex flex-wrap justify-center gap-2" aria-label="The four steps">
                {PROJECT_STAGES.map((stage, index) => (
                  <li
                    key={stage.key}
                    className="rounded-full border border-line px-3 py-1 text-sm text-fg-muted"
                  >
                    <span className="mr-1.5 text-fg-subtle tabular-nums">{index + 1}</span>
                    {stage.label}
                  </li>
                ))}
              </ol>
              <Button variant="secondary" leadingIcon={<Plus />} onClick={() => setCreating(true)}>
                Start a project
              </Button>
            </div>
          }
        />
      ) : (
        <section aria-labelledby="recent-heading" className="flex flex-col gap-4">
          <h2 id="recent-heading" className="text-sm font-medium text-fg-muted">
            Recent projects
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((project) => (
              <li key={project.id}>
                <ProjectCard
                  project={project}
                  onRenamed={(updated) =>
                    setItems((current) => {
                      const rest = current.filter((p) => p.id !== updated.id);
                      return [updated, ...rest];
                    })
                  }
                  onArchived={(id) => setItems((current) => current.filter((p) => p.id !== id))}
                />
              </li>
            ))}
          </ul>
          {cursor ? (
            <div className="flex justify-center pt-2">
              <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
                Load more
              </Button>
            </div>
          ) : (
            <Hint tone="info">Archived projects are kept safe and stay off this list.</Hint>
          )}
        </section>
      )}

      <NewProjectDialog open={creating} onOpenChange={setCreating} />
      <CoachMark
        open={!coach.dismissed && !creating}
        anchor={startButton}
        title="Start here"
        onDismiss={coach.dismiss}
        side="bottom"
        align="end"
      >
        Every film begins as a project. Pick a title and we will walk you through the rest.
      </CoachMark>
    </div>
  );
}
