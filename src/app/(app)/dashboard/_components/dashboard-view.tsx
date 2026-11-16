"use client";

import { useState } from "react";
import Link from "next/link";
import { stageLabel } from "@/lib/stages";
import { ActionMenu, Button, StatusLine, Tabs, Toolbar } from "@/ui";
import {
  projectHref,
  scriptHref,
  stageLine,
  stageTone,
  type ProjectSummary,
} from "../_lib/summary";
import { useProjectActions } from "./project-actions";
import { ProjectGrid } from "./project-grid";
import { StartFilm } from "./start-film";
import { useProjectList } from "./use-project-list";

/** The two slow lights behind the hero (the one decorative loop the owner asked for). */
function HeroGlows() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-30%] left-[4%] aspect-square w-[62%] glow-a rounded-full bg-radial-[closest-side] from-accent/17 to-accent/0 blur-[30px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-8%] bottom-[-55%] aspect-square w-[70%] glow-b rounded-full bg-radial-[closest-side] from-accent/11 to-accent/0 blur-[40px]"
      />
    </>
  );
}

/**
 * The hero for a library that has films: the most recent one rises large with Continue. The
 * film's other actions are on right-click, a long press and the item keys.
 */
function ContinueHero({
  film,
  onRenamed,
  onArchived,
}: {
  film: ProjectSummary;
  onRenamed: (project: ProjectSummary) => void;
  onArchived: (id: string) => void;
}) {
  const { verb, actions, dialogs } = useProjectActions(film, {
    onRenamed,
    onArchived,
    formId: "rename-hero-project",
  });
  const script = scriptHref(film);
  return (
    <>
      <ActionMenu
        actions={actions}
        label={`Actions for ${film.title}`}
        render={<section aria-label="Continue your film" />}
        className="relative mx-3 mb-3 flex min-h-[max(520px,56dvh)] flex-col justify-end gap-10 overflow-hidden rounded-block bg-hero p-5 sm:p-10"
      >
        <HeroGlows />
        <div className="relative flex min-w-0 flex-col gap-5">
          <div className="rise-mask">
            <h1
              title={film.title}
              className="-ml-[0.04em] rise line-clamp-3 max-w-(--measure) text-hero-title text-balance break-words"
            >
              {film.title}
            </h1>
          </div>
          <div aria-hidden="true" className="h-[3px] w-12 rule-in rounded-capsule bg-brand" />
          <StatusLine tone={stageTone(film.stage)} className="in-2">
            {stageLabel(film.stage)} · {stageLine(film)}
          </StatusLine>
        </div>
        <div className="relative flex in-3 flex-wrap items-center gap-3">
          <Button variant="primary" size="large" render={<Link href={projectHref(film)} />}>
            {verb}
          </Button>
          {script ? (
            <Button
              variant="outlined"
              size="large"
              className="border-outline-hero"
              render={<Link href={script} />}
            >
              Open Script
            </Button>
          ) : null}
        </div>
      </ActionMenu>
      {dialogs}
    </>
  );
}

/** The hero when nothing exists yet: the same stage, with the way to start in it. */
function EmptyHero() {
  return (
    <section
      aria-label="Start your first film"
      className="relative mx-3 mb-3 flex min-h-[max(520px,56dvh)] flex-1 flex-col justify-end overflow-hidden rounded-block bg-hero p-5 sm:p-10"
    >
      <HeroGlows />
      <div className="relative flex min-w-0 flex-col gap-10">
        <div className="flex flex-col gap-5">
          <div className="rise-mask">
            <h1 className="-ml-[0.04em] rise text-hero-title text-balance uppercase">
              No Films Yet
            </h1>
          </div>
          <div aria-hidden="true" className="h-[3px] w-12 rule-in rounded-capsule bg-brand" />
          <p className="max-w-(--measure) in-1 text-body text-pretty text-label-2">
            Start your first film. You choose its style next, and Claude names it once you describe
            the story.
          </p>
        </div>
        <div className="in-3">
          <StartFilm emphasis />
        </div>
      </div>
    </section>
  );
}

type Filter = "all" | "progress" | "finished";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "progress", label: "In Progress" },
  { value: "finished", label: "Finished" },
];

const EMPTY: Record<Exclude<Filter, "all">, { title: string; text: string }> = {
  progress: { title: "No films in progress", text: "Every film you started is finished." },
  finished: {
    title: "No finished films yet",
    text: "A film appears here once its production is complete.",
  },
};

const isFilter = (value: string): value is Filter => FILTERS.some((f) => f.value === value);

/** Your films as tiles, under the All / In Progress / Finished filter. */
function YourFilms({ list }: { list: ReturnType<typeof useProjectList> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const hasMore = Boolean(list.cursor);

  function shown(value: Filter): ProjectSummary[] {
    if (value === "all") return list.items;
    return list.items.filter((p) => (p.stage === "done") === (value === "finished"));
  }

  return (
    <section aria-labelledby="your-films" className="flex flex-col gap-5">
      <h2 id="your-films" className="text-section">
        Your Films
      </h2>
      <Tabs
        aria-label="Filter films"
        tabs={FILTERS}
        value={filter}
        onValueChange={(next) => {
          if (isFilter(next)) setFilter(next);
        }}
        panelClassName="pt-6"
      >
        {(value) => {
          const current: Filter = isFilter(value) ? value : "all";
          const items = shown(current);
          if (current !== "all" && items.length === 0 && !hasMore) {
            const empty = EMPTY[current];
            return (
              <div className="flex max-w-(--measure) flex-col items-start gap-2 py-6">
                <p className="text-heading-sm text-balance">{empty.title}</p>
                <p className="text-body text-pretty text-label-2">{empty.text}</p>
                {current === "finished" ? (
                  <Button variant="outlined" className="mt-6" onClick={() => setFilter("progress")}>
                    Show In Progress
                  </Button>
                ) : null}
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
              baseDelay={current === "all" ? 460 : 40}
              archivedNote
            />
          );
        }}
      </Tabs>
    </section>
  );
}

export function DashboardView({
  initialItems,
  initialCursor,
}: {
  initialItems: ProjectSummary[];
  initialCursor: string | null;
}) {
  const list = useProjectList(initialItems, initialCursor);
  const upNext = list.items[0];

  return (
    <>
      <Toolbar />
      {upNext ? (
        <>
          <ContinueHero film={upNext} onRenamed={list.onRenamed} onArchived={list.onArchived} />
          <div className="flex flex-col gap-16 px-(--content-x) pt-11 pb-18">
            <section aria-labelledby="start-film" className="flex in-3 flex-col gap-4">
              <h2 id="start-film" className="text-section">
                Start a New Film
              </h2>
              <StartFilm />
            </section>
            <YourFilms list={list} />
          </div>
        </>
      ) : (
        <EmptyHero />
      )}
    </>
  );
}
