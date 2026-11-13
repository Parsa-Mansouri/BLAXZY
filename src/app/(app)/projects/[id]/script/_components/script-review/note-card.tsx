import { findQuote } from "../../_lib/screenplay";
import { FindingNote } from "../finding-note";
import { LineComment, type DraftComment } from "../review-comments";
import type { Finding } from "../version-types";
import { noteFieldId, quoteId } from "./review-dom";
import type { CommentApi, MarginNote, PlacedFinding } from "./review-types";

/** Findings that quote a passage go beside it; the rest are about the whole script. */
export function placeFindings(content: string, findings: Finding[] | null) {
  const placed: PlacedFinding[] = [];
  const loose: Finding[] = [];
  (findings ?? []).forEach((finding, i) => {
    const range = finding.quote ? findQuote(content, finding.quote) : null;
    if (range) placed.push({ finding, key: `finding-${i}`, start: range.start });
    else loose.push(finding);
  });
  return { placed, loose };
}

/** A note beside (or under) the text: a script check, or one of the reviewer's comments. */
export function NoteCard({
  note,
  active,
  comments,
  onActivate,
  onRemove,
}: {
  note: MarginNote;
  active: boolean;
  comments: CommentApi | null;
  onActivate: (id: string) => void;
  onRemove: (comment: DraftComment) => void;
}) {
  if (note.kind === "finding") return <FindingNote finding={note.finding} />;
  if (!comments) return null;
  const c = note.comment;
  const shortQuote = c.quote.length > 160 ? `${c.quote.slice(0, 160)}…` : c.quote;
  return (
    <div
      data-active={active ? "" : undefined}
      className="border-l-2 border-transparent pl-3 transition-colors duration-(--dur-press) ease-out data-active:border-brand"
      onPointerEnter={() => onActivate(c.id)}
      onPointerLeave={() => onActivate("")}
      onFocus={() => onActivate(c.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onActivate("");
      }}
    >
      <span id={quoteId(c.id)} className="sr-only">
        On “{shortQuote}”
      </span>
      <LineComment
        comment={c}
        fieldId={noteFieldId(c.id)}
        describedBy={quoteId(c.id)}
        onChange={(text) => comments.update(c.id, text)}
        onRemove={() => onRemove(c)}
        onDiscard={() => comments.remove(c.id)}
      />
    </div>
  );
}
