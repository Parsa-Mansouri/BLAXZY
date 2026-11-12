import type { ReactNode } from "react";
import { cn } from "@/ui";
import type { ScreenplayLine } from "../_lib/screenplay";
import type { Scene, ScreenplayBlock } from "../_lib/scenes";

/**
 * The paper behind screenplay text, as a layer under its content (the review sets comments beside
 * the text, so the paper cannot be the text's own box). The light paper on the black ground shows
 * its edge by itself: no rim, shadow or stacked pages.
 */
export function PaperLayers({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-y-0 left-0 -z-10 rounded-paper bg-paper",
        className,
      )}
    />
  );
}

/** Horizontal padding of text on the sheet (the kit PaperSheet's inset). */
export const SHEET_X = "px-[clamp(20px,4vw,52px)]";
/** The same inset as a margin, for a dark card set under a block on the sheet. */
export const SHEET_MX = "mx-[clamp(20px,4vw,52px)]";
/** The same inset from the right, for the keyboard comment button on a block. */
export const SHEET_RIGHT = "right-[clamp(20px,4vw,52px)]";

/** Ink-coloured text selection and focus rings for anything set on the paper. */
export const ON_PAPER = "selection:bg-ink/20 selection:text-ink [&_:focus-visible]:outline-ink";

/** Renders a line's text; the review splits it into marked segments. Default: the plain text. */
export type RenderLineText = (line: ScreenplayLine) => ReactNode;

function LineText({
  line,
  className,
  render,
}: {
  line: ScreenplayLine;
  className?: string;
  render?: RenderLineText;
}) {
  return (
    <span className={cn("block break-words whitespace-pre-wrap", className)}>
      {render ? render(line) : line.text}
    </span>
  );
}

/** One block of the screenplay in Courier on paper: heading, paragraph, speech or transition. */
export function BlockText({
  block,
  id,
  renderText,
}: {
  block: ScreenplayBlock;
  id?: string;
  renderText?: RenderLineText;
}) {
  switch (block.kind) {
    case "heading":
      return (
        <h2 id={id} className="font-bold uppercase">
          {block.lines.map((l) => (
            <LineText key={l.start} line={l} render={renderText} />
          ))}
        </h2>
      );
    case "episode":
      return (
        <p id={id} className="font-bold uppercase">
          {block.lines.map((l) => (
            <LineText key={l.start} line={l} render={renderText} />
          ))}
        </p>
      );
    case "transition":
      return (
        <p id={id} className="text-right uppercase">
          {block.lines.map((l) => (
            <LineText key={l.start} line={l} render={renderText} />
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
              render={renderText}
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
            <LineText key={l.start} line={l} render={renderText} />
          ))}
        </p>
      );
  }
}

/** The script's title and logline, set at the top of the first page. */
export function TitlePage({ title, logline }: { title: string; logline: string | null }) {
  return (
    <div className="flex flex-col items-center gap-3 pb-6 text-center">
      <p className="max-w-[36ch] font-bold text-balance break-words uppercase">{title}</p>
      {logline ? <p className="max-w-[48ch] text-pretty break-words">{logline}</p> : null}
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
        // The kit's `paper` surface (paper, ink, its own selection and focus colours).
        "flex w-full max-w-205 flex-col gap-6 rounded-paper py-11 font-script text-script paper",
        SHEET_X,
        className,
      )}
    >
      {top}
      {scenes.length === 0 ? <p>This version has no text.</p> : null}
      {scenes.flatMap((scene) =>
        scene.blocks.map((block) => <BlockText key={block.start} block={block} />),
      )}
    </article>
  );
}
