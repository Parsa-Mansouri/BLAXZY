import type { ReactNode } from "react";
import { cn } from "@/ui";
import type { ScreenplayLine } from "../_lib/screenplay";
import type { Scene, ScreenplayBlock } from "../_lib/scenes";

/**
 * The paper sheet for screenplay text. A drop shadow cannot be seen on a black ground, so the
 * sheet shows its edge another way: a hairline rim, a slightly darker bottom edge, and the page
 * under it peeking out at the lower right, like the top sheet of a short stack.
 */
export function PaperLayers({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-y-0 left-0 -z-10", className)}
    >
      <span className="absolute inset-0 translate-x-[5px] translate-y-[6px] rounded-paper bg-[color-mix(in_srgb,var(--paper)_46%,var(--ground))]" />
      <span className="absolute inset-0 rounded-paper bg-paper shadow-[inset_0_0_0_1px_rgb(27_26_23/0.12),inset_0_-3px_0_rgb(27_26_23/0.07)]" />
    </span>
  );
}

/** Horizontal padding of text on the sheet. */
export const SHEET_X = "px-[clamp(20px,4vw,48px)]";

/** Ink-coloured text selection and focus rings for anything set on the paper. */
export const ON_PAPER = "selection:bg-ink/20 selection:text-ink [&_:focus-visible]:outline-ink";

function LineText({ line, className }: { line: ScreenplayLine; className?: string }) {
  return (
    <span className={cn("block break-words whitespace-pre-wrap", className)}>{line.text}</span>
  );
}

/** One block of the screenplay in Courier on paper: heading, paragraph, speech or transition. */
export function BlockText({ block, id }: { block: ScreenplayBlock; id?: string }) {
  switch (block.kind) {
    case "heading":
      return (
        <h2 id={id} className="font-bold uppercase">
          {block.lines.map((l) => (
            <LineText key={l.start} line={l} />
          ))}
        </h2>
      );
    case "episode":
      return (
        <p id={id} className="font-bold uppercase">
          {block.lines.map((l) => (
            <LineText key={l.start} line={l} />
          ))}
        </p>
      );
    case "transition":
      return (
        <p id={id} className="text-right uppercase">
          {block.lines.map((l) => (
            <LineText key={l.start} line={l} />
          ))}
        </p>
      );
    case "dialogue":
      return (
        <div id={id} className="px-[12%]">
          {block.lines.map((l) => (
            <LineText
              key={l.start}
              line={l}
              className={
                l.type === "character"
                  ? "pl-[30%] uppercase"
                  : l.type === "parenthetical"
                    ? "pl-[18%]"
                    : undefined
              }
            />
          ))}
        </div>
      );
    case "action":
      return (
        <p id={id}>
          {block.lines.map((l) => (
            <LineText key={l.start} line={l} />
          ))}
        </p>
      );
  }
}

/** The script's title and logline, set at the top of the first page. */
export function TitlePage({ title, logline }: { title: string; logline: string | null }) {
  return (
    <div className="flex flex-col items-center gap-3 pb-6 text-center">
      <p className="font-bold uppercase">{title}</p>
      {logline ? <p className="max-w-[48ch] text-pretty">{logline}</p> : null}
    </div>
  );
}

/** A read-only sheet: the given scenes' blocks, in Courier on paper, at most 820px wide. */
export function ReadingSheet({
  scenes,
  top,
  className,
  "aria-label": ariaLabel,
}: {
  scenes: Scene[];
  /** Shown above the text, e.g. the title page. */
  top?: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <article
      aria-label={ariaLabel}
      className={cn(
        "relative isolate flex w-full max-w-205 flex-col gap-6 py-11 font-script text-script text-ink",
        ON_PAPER,
        SHEET_X,
        className,
      )}
    >
      <PaperLayers className="right-0" />
      {top}
      {scenes.length === 0 ? <p>This version has no text.</p> : null}
      {scenes.flatMap((scene) =>
        scene.blocks.map((block) => <BlockText key={block.start} block={block} />),
      )}
    </article>
  );
}
