"use client";

import Link from "next/link";
import { stageLabel } from "@/lib/stages";
import { Button, StatusLine, Toolbar } from "@/ui";
import {
  projectHref,
  scriptHref,
  stageLine,
  stageTone,
  type ProjectSummary,
} from "../_lib/summary";
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

/** The hero for a library that has films: the most recent one rises large with Continue. */
function ContinueHero({ film }: { film: ProjectSummary }) {
  const verb = film.stage === "done" ? "Open" : "Continue";
  const script = scriptHref(film);
  return (
    <section
      aria-label="Continue your film"
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
    </section>
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
            Give your first film a working title. You choose its style next.
          </p>
        </div>
        <div className="in-3">
          <StartFilm emphasis />
        </div>
      </div>
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
          <ContinueHero film={upNext} />
          <div className="flex flex-col gap-16 px-(--content-x) pt-11 pb-18">
            <section aria-labelledby="start-film" className="flex in-3 flex-col gap-4">
              <h2 id="start-film" className="text-section">
                Start a New Film
              </h2>
              <StartFilm />
            </section>
            <section aria-labelledby="your-films" className="flex flex-col gap-5">
              <h2 id="your-films" className="text-section">
                Your Films
              </h2>
              <ProjectGrid
                items={list.items}
                hasMore={Boolean(list.cursor)}
                loadingMore={list.loadingMore}
                onLoadMore={list.loadMore}
                onRenamed={list.onRenamed}
                onArchived={list.onArchived}
                baseDelay={460}
              />
            </section>
          </div>
        </>
      ) : (
        <EmptyHero />
      )}
    </>
  );
}
