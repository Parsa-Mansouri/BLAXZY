"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PROJECT_STAGES, stageLabel, stageStep } from "@/lib/stages";
import { Button, TitleCard, Tip, Toolbar, useDismissed } from "@/ui";
import type { ProjectSummary } from "../_lib/summary";
import { NewProjectDialog } from "./new-project-dialog";
import { ProjectGrid } from "./project-grid";
import { useProjectList } from "./use-project-list";

export function DashboardView({
  initialItems,
  initialCursor,
}: {
  initialItems: ProjectSummary[];
  initialCursor: string | null;
}) {
  const list = useProjectList(initialItems, initialCursor);
  const [creating, setCreating] = useState(false);
  const newButton = useRef<HTMLElement>(null);
  const tip = useDismissed("dashboard-start-project");
  const upNext = list.items[0];

  return (
    <>
      <Toolbar
        title="Home"
        trailing={
          upNext ? (
            <Button
              ref={newButton}
              variant="prominent"
              leadingIcon={<Plus />}
              onClick={() => setCreating(true)}
              aria-label="New Project"
              className="max-sm:w-(--control-h) max-sm:px-0"
            >
              <span className="max-sm:sr-only">New Project</span>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-10 px-(--content-x) pt-2 pb-16">
        {upNext ? (
          <>
            <section aria-labelledby="up-next" className="flex flex-col gap-3">
              <h2 id="up-next" className="text-title-2">
                Up Next
              </h2>
              <TitleCard
                size="hero"
                title={upNext.title}
                line={`${stageLabel(upNext.stage)} · ${stageStep(upNext.stage)}`}
                action={
                  <Button
                    variant="standard"
                    size="large"
                    render={<Link href={`/projects/${upNext.id}`} />}
                    aria-label={`Continue ${upNext.title}`}
                  >
                    Continue
                  </Button>
                }
              />
            </section>
            <section aria-labelledby="projects" className="flex flex-col gap-3">
              <h2 id="projects" className="text-title-2">
                Projects
              </h2>
              <ProjectGrid
                items={list.items}
                hasMore={Boolean(list.cursor)}
                loadingMore={list.loadingMore}
                onLoadMore={list.loadMore}
                onRenamed={list.onRenamed}
                onArchived={list.onArchived}
              />
            </section>
          </>
        ) : (
          <section
            aria-labelledby="opening"
            className="flex max-w-(--measure) flex-col gap-8 pt-6 shell:pt-12"
          >
            <div className="flex flex-col gap-3">
              <h2 id="opening" className="text-large-title text-balance">
                Make a film from an idea or a script.
              </h2>
              <p className="text-reading text-label-2">
                BLAXZY takes a project through four stages and returns every clip of the film,
                organised by scene and ready for your editor.
              </p>
            </div>
            <div>
              <Button
                ref={newButton}
                variant="prominent"
                size="large"
                leadingIcon={<Plus />}
                onClick={() => setCreating(true)}
              >
                New Project
              </Button>
            </div>
            <ol aria-label="The four stages" className="flex flex-col">
              {PROJECT_STAGES.map((stage, index) => (
                <li
                  key={stage.key}
                  className="grid grid-cols-[--spacing(8)_1fr] gap-x-2 py-3 hairline-t"
                >
                  <span className="text-headline text-label-2 tabular-nums">{index + 1}</span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-headline">{stage.label}</span>
                    <span className="text-body text-label-2">{stage.summary}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      <NewProjectDialog open={creating} onOpenChange={setCreating} />
      <Tip
        open={!tip.dismissed && !creating}
        anchor={newButton}
        title="Create a Project"
        onDismiss={tip.dismiss}
        side={upNext ? "bottom" : "right"}
        align={upNext ? "end" : "center"}
      >
        Each film starts as a project. Give it a working title and BLAXZY guides you through the
        four stages.
      </Tip>
    </>
  );
}
