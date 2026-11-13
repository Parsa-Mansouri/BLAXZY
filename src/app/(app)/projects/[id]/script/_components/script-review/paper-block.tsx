import { memo } from "react";
import { Button, cn } from "@/ui";
import { splitSegments, type MarkRange } from "../../_lib/review-ranges";
import type { ScreenplayBlock } from "../../_lib/scenes";
import type { ScreenplayLine } from "../../_lib/screenplay";
import { ON_PAPER, SHEET_RIGHT, SHEET_X, BlockText } from "../screenplay-sheet";
import { lineButtonId } from "./review-dom";

/**
 * One block of the script on the paper, its lines split into segments at comment and finding
 * boundaries. Memoised: typing in a comment does not re-render the script.
 */
export const PaperBlock = memo(function PaperBlock({
  block,
  marks,
  cuts,
  canAdd,
  onComment,
}: {
  block: ScreenplayBlock;
  marks: MarkRange[];
  cuts: number[];
  /** Comments are open and there is room for another. */
  canAdd: boolean;
  /** Null on a read-only sheet. */
  onComment: ((block: ScreenplayBlock) => void) | null;
}) {
  const renderText = (line: ScreenplayLine) =>
    splitSegments(line.start, line.end, marks, cuts).map((seg) => (
      <span
        key={seg.start}
        data-at={seg.start}
        data-c={seg.ids.length > 0 ? seg.ids.join(" ") : undefined}
        className={
          seg.ids.length > 0
            ? cn(
                "rounded-mark transition-colors duration-(--dur-press) ease-out",
                seg.ids.length > 1 ? "bg-brand/40" : "bg-brand/25",
              )
            : undefined
        }
      >
        {line.text.slice(seg.start - line.start, seg.end - line.start)}
      </span>
    ));

  return (
    <div data-block className={cn("relative w-(--sheet-w) shrink-0", SHEET_X, ON_PAPER)}>
      <BlockText block={block} renderText={renderText} />
      {onComment ? (
        // The keyboard way to comment: shown only while it has keyboard focus.
        <Button
          id={lineButtonId(block.start)}
          variant="dark"
          size="small"
          aria-label="Comment on this line"
          disabled={!canAdd}
          onClick={() => onComment(block)}
          className={cn(
            SHEET_RIGHT,
            "absolute top-0 -translate-y-1 font-sans select-none",
            "pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100",
          )}
        >
          Comment
        </Button>
      ) : null}
    </div>
  );
});
