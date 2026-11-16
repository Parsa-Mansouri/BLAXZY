import type { CSSProperties, ReactNode } from "react";
import { SIMPLICITY_VIDEO, STEPS } from "./content";
import { LoopVideo } from "./loop-video";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-title";

/** Per-element stagger inside a stage's turn (the `--l` step, see `.st-*` in globals.css). */
function at(l: number): CSSProperties {
  return { "--l": l } as CSSProperties;
}

/** Style: a selection frame hops across three looks and settles on one. */
function StyleScene() {
  return (
    <div className="relative grid w-full grid-cols-3 gap-2">
      <span className="aspect-[3/4] bg-[linear-gradient(160deg,#3d4b57,#0e1114_70%)]" />
      <span className="aspect-[3/4] bg-[linear-gradient(160deg,#8a8f99,#2a2d33_75%)]" />
      <span className="aspect-[3/4] bg-[repeating-linear-gradient(0deg,#1c1d20_0_6px,#2b2c30_6px_12px)]" />
      <span
        aria-hidden="true"
        className="st-pick absolute inset-y-0 left-0 w-[calc((100%-1rem)/3)] outline-2 outline-offset-3 outline-label"
      />
    </div>
  );
}

/** Script: screenplay lines write themselves, heading, action, a name, dialogue. */
function ScriptScene() {
  const lines: [string, string][] = [
    ["w-3/4", "self-start"],
    ["w-full", "self-start"],
    ["w-1/4", "self-center"],
    ["w-1/2", "self-center"],
    ["w-2/5", "self-center"],
  ];
  return (
    <div className="flex w-full flex-col gap-3 bg-label/95 p-5">
      {lines.map(([width, align], index) => (
        <span
          key={index}
          className={`st-line h-1.5 origin-left bg-ground ${width} ${align} ${index === 2 ? "h-2" : ""}`}
          style={at(index)}
        />
      ))}
    </div>
  );
}

/** Pre-production: the same character, frame after frame. */
function CastScene() {
  return (
    <div className="grid w-full grid-cols-3 gap-2">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="st-pop relative aspect-[3/4] overflow-hidden bg-fill-2"
          style={at(index)}
        >
          <span className="absolute top-[22%] left-1/2 size-[34%] -translate-x-1/2 rounded-full bg-label" />
          <span className="absolute -bottom-[18%] left-1/2 h-[46%] w-[78%] -translate-x-1/2 rounded-t-full bg-label" />
        </span>
      ))}
    </div>
  );
}

/** Production: clips drop onto a timeline while the playhead runs across. */
function ProductionScene() {
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="grid grid-cols-4 gap-1.5">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className="st-pop aspect-video bg-fill-2" style={at(index)}>
            <span className="block h-full w-[38%] bg-label/80" />
          </span>
        ))}
      </div>
      <span className="relative h-0.5 w-full bg-fill">
        <span className="st-play absolute inset-0 origin-left bg-label" />
      </span>
    </div>
  );
}

const SCENES: Record<string, ReactNode> = {
  Style: <StyleScene />,
  Script: <ScriptScene />,
  "Pre-production": <CastScene />,
  Production: <ProductionScene />,
};

/**
 * How it works, shown rather than told: the app's stage strip set large, one small scene per
 * stage. A single loop walks through the stages in turn: each one's bar fills, its name lights
 * and its scene plays, then the next. Under reduced motion everything stands finished.
 * Hamed's video, once SIMPLICITY_VIDEO is set, plays above the strip.
 */
export function CallSheet() {
  const video = SIMPLICITY_VIDEO;
  return (
    <section id="how" aria-label="How it works" className="flex flex-col gap-24 pt-36 pb-12">
      <SectionHead title="Four steps. One film." />

      <Reveal mode="group" className="flex flex-col gap-16 px-(--content-x)">
        {video ? (
          <div className="enter">
            <LoopVideo
              onSight
              src={video.src}
              poster={video.poster}
              className="aspect-video w-full rounded-mark object-cover"
            />
          </div>
        ) : null}

        <ol className="grid enter gap-x-3 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li
              key={step.name}
              className="flex min-w-0 flex-col gap-5"
              style={{ "--i": index } as CSSProperties}
            >
              <div
                aria-hidden="true"
                className="grid aspect-[4/3] place-items-center border border-separator-opaque p-[12%]"
              >
                {SCENES[step.name]}
              </div>
              <span aria-hidden="true" className="relative h-0.5 w-full bg-stage-todo">
                <span className="st-bar absolute inset-0 origin-left bg-label" />
              </span>
              <span className="st-name credit">{step.name}</span>
            </li>
          ))}
        </ol>
      </Reveal>
    </section>
  );
}
