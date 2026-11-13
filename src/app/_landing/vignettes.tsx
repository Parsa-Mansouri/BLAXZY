import type { ReactNode } from "react";
import {
  Button,
  DemoHint,
  ProgressBar,
  ScreenplayDialogue,
  SilhouetteScene,
  StatusLine,
  Tick,
  TypingScene,
  cn,
} from "@/ui";

/*
  Product vignettes for the landing page: BLAXZY's own screens, slightly abstracted, built from
  the kit and the tokens. They are pictures of the product, not controls: wherever one is placed
  it is `aria-hidden` and `inert`, its "buttons" render as spans, and its pictures are the kit's
  silhouettes (never a fake generated still). One story runs through all of them: Mara and the
  lighthouse, the same film as the deliverable tree in content.ts.
*/

/** The line Mara speaks in every screenplay fragment. */
export const MARA_LINE = "If the lamp goes out tonight, nobody finds their way home.";

/**
 * A picture slot drawn as the app draws an empty one: the kit's silhouette of the asset kind on a
 * dark tile, built up piece by piece on first sight. `still` shows the finished sketch at once
 * (for long rows of frames).
 */
export function Sketch({
  kind,
  still = false,
  delay = 0,
  className,
}: {
  kind: string;
  still?: boolean;
  delay?: number;
  className?: string;
}) {
  if (still) {
    return (
      <div className={cn("relative overflow-hidden bg-elevated", className)}>
        <span className="absolute inset-0 text-label-4 opacity-80 [&_*]:animate-none">
          <SilhouetteScene kind={kind} />
        </span>
      </div>
    );
  }
  return (
    <div className={cn("demo-host bg-elevated", className)}>
      <DemoHint mask="none" delay={delay}>
        <SilhouetteScene kind={kind} />
      </DemoHint>
    </div>
  );
}

/** A button as a picture: the kit's capsule rendered as a span, so nothing in a vignette takes focus. */
function PictureButton({
  variant,
  children,
  icon,
}: {
  variant: "outlined" | "dark";
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Button variant={variant} size="small" leadingIcon={icon} render={<span />}>
      {children}
    </Button>
  );
}

/* ---------- Style: the look as picture options ---------- */

function LookTile({
  kind,
  label,
  selected = false,
  delay,
}: {
  kind: string;
  label: string;
  selected?: boolean;
  delay: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Sketch
        kind={kind}
        delay={delay}
        className={cn("aspect-video rounded-tile", selected && "ring-2 ring-brand")}
      />
      <p
        className={cn(
          "flex items-center gap-2 px-0.5 text-row",
          selected ? "font-semibold text-label" : "text-label-2",
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        {selected ? <Tick animate={false} /> : null}
      </p>
    </div>
  );
}

/** A frame shape drawn to its real proportions. */
function FrameShape({
  label,
  wide,
  selected = false,
}: {
  label: string;
  wide: boolean;
  selected?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-2.5">
      <div
        className={cn(
          "h-14 rounded-tile bg-elevated",
          wide ? "aspect-video" : "aspect-[9/16]",
          selected && "ring-2 ring-brand",
        )}
      />
      <p
        className={cn(
          "flex items-center gap-2 px-0.5 text-meta",
          selected ? "font-semibold text-label" : "text-label-2",
        )}
      >
        {label}
        {selected ? <Tick animate={false} /> : null}
      </p>
    </div>
  );
}

/** The Style screen: how it should look, chosen from pictures, then the frame and the length. */
export function StyleVignette() {
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="caps-label text-label-3">Style</p>
        <p className="text-heading-sm text-label">How should it look?</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <LookTile kind="creature" label="Animation" delay={0} />
        <LookTile kind="location" label="Cinematic" selected delay={300} />
      </div>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <FrameShape label="Landscape" wide selected />
        <FrameShape label="Portrait" wide={false} />
        <div className="ml-auto flex flex-col items-end gap-1">
          <p className="text-meta text-label-2">A movie, about</p>
          <p className="mono-value text-section text-label">00:12:00</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Script: the screenplay on paper, the last line being written ---------- */

/**
 * The screenplay paper: a scene heading, an action line, and Mara's line typing in. `compact` is
 * the hero's smaller sheet.
 */
export function ScriptPage({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-col rounded-paper font-script paper",
        compact
          ? "gap-3 px-6 py-5 text-secondary"
          : "gap-6 px-[clamp(20px,4vw,40px)] py-9 text-script",
        className,
      )}
    >
      <p className="font-bold">INT. LIGHTHOUSE – NIGHT</p>
      <p>
        {compact
          ? "Rain needles the glass. MARA climbs the last turn of the stair."
          : "Rain needles the glass. MARA climbs the last turn of the stair, the storm lantern swinging in her fist."}
      </p>
      <ScreenplayDialogue who="MARA" className={compact ? "px-[6%]" : undefined}>
        <span className="demo-host relative block">
          {/* The finished line sizes the box; the typing plays over it. */}
          <span className="invisible">{MARA_LINE}</span>
          <DemoHint
            mask="none"
            delay={200}
            className="[--demo-ink:var(--ink)] [--demo-pad:0px] [--demo-strength:1]"
          >
            <TypingScene font="inherit" lines={[MARA_LINE]} timing={{ stepMs: 42 }} />
          </DemoHint>
        </span>
      </ScreenplayDialogue>
    </div>
  );
}

/** The Script screen: the paper on its dark ground, with where it stands. */
export function ScriptVignette() {
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="caps-label text-label-3">Scene 01</p>
        <StatusLine tone="working">Writing</StatusLine>
      </div>
      <ScriptPage />
    </div>
  );
}

/* ---------- Pre-production: the casting dossier and the asset tiles ---------- */

/** A character's dossier: the portrait slot, the name, who she is and where her sheet stands. */
export function DossierCard({
  compact = false,
  className,
}: {
  /** The hero's smaller card: a narrower portrait and a shorter description. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-5 rounded-block bg-elevated-2 p-5", className)}>
      <Sketch
        kind="character"
        className={cn("aspect-[4/5] shrink-0 rounded-tile", compact ? "w-[30%]" : "w-[38%]")}
      />
      <div className="flex min-w-0 flex-col justify-center gap-2.5">
        <p className="caps-label text-label-3">Character</p>
        <p className="text-heading-sm text-label">Mara</p>
        <p className="text-secondary text-label-2">
          {compact
            ? "The lighthouse keeper."
            : "The lighthouse keeper. Forties, salt in her hair, never without the lantern."}
        </p>
        <StatusLine tone="done">Sheet ready</StatusLine>
      </div>
    </div>
  );
}

const ASSETS: readonly {
  kind: string;
  name: string;
  tone: "done" | "waiting" | "working";
  status: string;
}[] = [
  { kind: "location", name: "The Lighthouse", tone: "waiting", status: "Review the image" },
  { kind: "prop", name: "Storm Lantern", tone: "working", status: "Building the sheet" },
  { kind: "voice", name: "Mara’s Voice", tone: "done", status: "Ready" },
];

/** The Pre-production screen: the dossier on top, the rest of the cast and places beneath. */
export function PreProductionVignette() {
  return (
    <div className="flex w-full flex-col gap-6">
      <DossierCard />
      <div className="grid grid-cols-3 gap-3">
        {ASSETS.map((asset, i) => (
          <div key={asset.name} className="flex min-w-0 flex-col gap-2">
            <Sketch kind={asset.kind} delay={600 + i * 300} className="aspect-video rounded-tile" />
            <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
              <p className="truncate text-meta font-semibold text-label">{asset.name}</p>
              <StatusLine tone={asset.tone} className="hidden sm:flex">
                {asset.status}
              </StatusLine>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Production: a take to judge, and the scene's blocks ---------- */

/** Seconds into a 15-second block as a timecode. */
const blockTime = (percent: number) =>
  `00:00:${String(Math.round((percent / 100) * 15)).padStart(2, "0")}:00`;

/**
 * A clip's frame: the place it is set, its file name and its length, with the playhead part of
 * the way along.
 */
export function TakeFrame({
  file,
  kind = "location",
  played = 38,
  still = false,
  className,
}: {
  file: string;
  kind?: string;
  /** How far the playhead is, 0 to 100. */
  played?: number;
  still?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-tile", className)}>
      <Sketch kind={kind} still={still} className="absolute inset-0" />
      <p className="absolute inset-x-0 top-0 truncate p-3 mono-value text-meta text-label-2">
        {file}
      </p>
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="mono-value text-meta text-label-2">{blockTime(played)}</span>
          <span className="mono-value text-meta text-label-3">00:00:15:00</span>
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-capsule bg-fill">
          <div className="h-full rounded-capsule bg-label-2" style={{ width: `${played}%` }} />
        </div>
      </div>
    </div>
  );
}

const BLOCKS: readonly {
  name: string;
  kind: string;
  tone: "done" | "waiting" | "working";
  status: string;
  current?: boolean;
  progress?: number;
}[] = [
  { name: "Block 01", kind: "character", tone: "done", status: "Accepted" },
  { name: "Block 02", kind: "location", tone: "waiting", status: "Take 2", current: true },
  { name: "Block 03", kind: "prop", tone: "working", status: "Rendering", progress: 64 },
];

/** The Production screen: take 2 of block 02 waiting for a verdict, the scene's blocks beneath. */
export function ProductionVignette() {
  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-3">
        <TakeFrame file="clip_e01_s01_b02.mp4" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-row font-semibold text-label">Block 02 · Take 2</p>
            <p className="text-meta text-label-2">Take 1 rejected: the lantern changed hands.</p>
          </div>
          <div className="flex gap-2">
            <PictureButton variant="outlined">Reject</PictureButton>
            <PictureButton variant="dark" icon={<Tick animate={false} className="text-label" />}>
              Accept
            </PictureButton>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {BLOCKS.map((block) => (
          <div key={block.name} className="flex min-w-0 flex-col gap-2">
            <Sketch
              kind={block.kind}
              still
              className={cn("aspect-video rounded-tile", block.current && "ring-2 ring-brand")}
            />
            <div className="flex min-w-0 flex-col gap-1 px-0.5">
              <p className="truncate text-meta font-semibold text-label">{block.name}</p>
              {block.progress !== undefined ? (
                <ProgressBar value={block.progress} aria-label="Rendering" className="py-1.5" />
              ) : (
                <StatusLine tone={block.tone}>{block.status}</StatusLine>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- The hero's stack ---------- */

/**
 * The hero's composition of the product, cascading down and across: the screenplay on paper,
 * Mara's dossier, and her first accepted take. Each layer overlaps the one above only by that
 * one's padding, so no text is covered, and each enters in turn after the headline.
 */
export function HeroStack({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" inert className={cn("flex w-full flex-col", className)}>
      <div className="w-[84%] enter self-end" style={{ animationDelay: "420ms" }}>
        <ScriptPage compact />
      </div>
      <div className="relative -mt-5 w-[86%] enter" style={{ animationDelay: "560ms" }}>
        <DossierCard compact className="shadow-float" />
      </div>
      <div className="relative -mt-4 w-[66%] enter self-end" style={{ animationDelay: "700ms" }}>
        <div className="flex flex-col gap-3 rounded-block bg-elevated-2 p-4 shadow-float">
          <TakeFrame file="clip_e01_s01_b01.mp4" played={60} still />
          <div className="flex items-center justify-between gap-3 px-1">
            <p className="truncate text-meta font-semibold text-label">Block 01 · Take 1</p>
            <StatusLine tone="done" className="shrink-0">
              Accepted
            </StatusLine>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- One vignette per stage ---------- */

/**
 * The screen of a stage, by its key in PROJECT_STAGES. Remount it (change its `key`) to play its
 * typing and sketches again.
 */
export function StageVignette({ stage }: { stage: string }) {
  switch (stage) {
    case "style":
      return <StyleVignette />;
    case "script":
      return <ScriptVignette />;
    case "pre_production":
      return <PreProductionVignette />;
    case "production":
      return <ProductionVignette />;
    default:
      return null;
  }
}
