import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/ui";
import { MAX_QUOTE_CHARS } from "../review-comments";
import type { Picked } from "./review-types";

/** The floating control by a selection: Comment, or why the selection cannot be commented on. */
export function SelectionControl({
  picked,
  full,
  onComment,
}: {
  picked: Picked;
  /** The review already holds the most comments it takes. */
  full: boolean;
  onComment: () => void;
}) {
  return (
    <div
      data-selection-ui
      className="absolute z-10 flex -translate-x-1/2 pop-in justify-center font-sans"
      style={{ top: picked.top, left: picked.left }}
    >
      {!picked.passage.ok ? (
        <p
          role="status"
          className="rounded-tile bg-elevated-2 px-3 py-2 text-meta text-label shadow-float"
        >
          Select under {MAX_QUOTE_CHARS.toLocaleString("en-US")} characters to comment.
        </p>
      ) : full ? (
        <p
          role="status"
          className="rounded-tile bg-elevated-2 px-3 py-2 text-meta text-label shadow-float"
        >
          You have 100 comments, the most one review takes.
        </p>
      ) : (
        <Button
          variant="dark"
          size="small"
          className="shadow-float"
          leadingIcon={<MessageSquarePlus aria-hidden="true" />}
          aria-label="Comment on the selected text"
          // Keep the selection while pressing.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onComment}
        >
          Comment
        </Button>
      )}
    </div>
  );
}
