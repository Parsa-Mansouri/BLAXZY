"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PROJECT_STAGES } from "@/lib/stages";
import { cn } from "@/ui";
import { STAGE_CHAPTERS } from "./content";
import { Reveal } from "./reveal";
import { StageVignette } from "./vignettes";

const SHELL = "(min-width: 60rem)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(SHELL);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the side-by-side layout is showing; the vignettes are only mounted for the layout in use. */
function useShell(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SHELL).matches,
    () => false,
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The four stages as chapters, each shown by its own screen. Wide: the screens are pinned on the
 * right and cross-fade with the chapter in view. Narrow: each chapter carries its own frame.
 */
export function StageReel() {
  const shell = useShell();
  const [view, setView] = useState({ active: 0, entered: [0, 0, 0, 0] });
  const { active } = view;
  const chapters = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = chapters.current.indexOf(entry.target as HTMLLIElement);
          if (index === -1) continue;
          // Count each chapter's entrances: the pinned screen remounts on each, so it plays again.
          setView((v) =>
            v.active === index
              ? v
              : { active: index, entered: v.entered.map((n, i) => (i === index ? n + 1 : n)) },
          );
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const el of chapters.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const stage = PROJECT_STAGES[active] ?? PROJECT_STAGES[0];

  return (
    <section id="stages" aria-label="The four stages" className="scroll-mt-(--toolbar-h) py-28">
      <Reveal mode="group" className="flex flex-col gap-6 px-(--content-x) pb-16">
        <h2 className="-ml-[0.04em] text-hero-title text-balance">
          <span className="rise-mask">
            <span className="rise">Four stages.</span>
          </span>
          <span className="rise-mask">
            <span className="rise" style={{ animationDelay: "90ms" }}>
              One film.
            </span>
          </span>
        </h2>
        <div
          aria-hidden="true"
          className="h-[3px] w-12 rule-in rounded-capsule bg-brand"
          style={{ animationDelay: "320ms" }}
        />
      </Reveal>

      <div className="grid gap-x-16 px-(--content-x) shell:grid-cols-2">
        <ol className="flex flex-col gap-24 shell:gap-0">
          {PROJECT_STAGES.map((s, index) => {
            const chapter = STAGE_CHAPTERS[s.key];
            const isActive = index === active;
            return (
              <li
                key={s.key}
                ref={(el) => {
                  chapters.current[index] = el;
                }}
                data-active={isActive}
                className="group flex flex-col justify-center gap-8 shell:min-h-[80dvh]"
              >
                {!shell ? (
                  <div aria-hidden="true" inert className="rounded-block bg-hero p-5 sm:p-8">
                    <StageVignette stage={s.key} />
                  </div>
                ) : null}
                <div className="relative flex flex-col gap-4 shell:pl-8">
                  <span
                    aria-hidden="true"
                    data-active={isActive}
                    className="absolute top-1 bottom-1 left-0 hidden w-[3px] chapter-mark rounded-capsule bg-brand shell:block"
                  />
                  <div className="flex items-center gap-4">
                    <span className="mono-value text-meta text-label-3">
                      {pad(index + 1)} / {pad(PROJECT_STAGES.length)}
                    </span>
                    <h3 className="caps-label text-label transition-colors duration-(--dur-swap) ease-(--ease-curve) shell:group-data-[active=false]:text-label-3">
                      {s.label}
                    </h3>
                  </div>
                  <p className="max-w-[18ch] text-heading text-balance text-label transition-colors duration-(--dur-swap) ease-(--ease-curve) shell:group-data-[active=false]:text-label-3">
                    {chapter?.heading}
                  </p>
                  <p className="max-w-(--measure) text-row text-pretty text-label-2 transition-colors duration-(--dur-swap) ease-(--ease-curve) shell:group-data-[active=false]:text-label-3">
                    {chapter?.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        <div aria-hidden="true" className="hidden shell:block">
          <div className="sticky top-[calc(var(--toolbar-h)+24px)] h-[calc(100dvh-var(--toolbar-h)-48px)]">
            <div className="relative size-full overflow-hidden rounded-block bg-hero">
              {shell
                ? PROJECT_STAGES.map((s, index) => (
                    <div
                      key={s.key}
                      inert
                      data-active={index === active}
                      className={cn(
                        "absolute inset-0 flex items-center justify-center px-10 pt-10 pb-24",
                        "transition-[opacity,transform] duration-(--dur-cover) ease-(--ease-curve)",
                        "data-[active=false]:translate-y-2 data-[active=false]:opacity-0",
                      )}
                    >
                      <div className="w-full max-w-[30rem]">
                        <StageVignette key={view.entered[index]} stage={s.key} />
                      </div>
                    </div>
                  ))
                : null}
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-6",
                  "bg-linear-to-t from-hero/90 to-transparent pt-16",
                )}
              >
                <p key={active} className="swap-in mono-value text-meta text-label-2">
                  SC {pad(active + 1)} · {stage?.label.toUpperCase()}
                </p>
                <p className="mono-value text-meta text-label-3">
                  {pad(active + 1)} / {pad(PROJECT_STAGES.length)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
