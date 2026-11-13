import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/ui";
import { trimRange, type MarkRange } from "../../_lib/review-ranges";
import type { Scene, ScreenplayBlock } from "../../_lib/scenes";
import { MAX_QUOTE_CHARS, type DraftComment } from "../review-comments";
import { PaperLayers, ON_PAPER, SHEET_MX, SHEET_X, TitlePage } from "../screenplay-sheet";
import { sceneName } from "../scene-list";
import { NoteCard } from "./note-card";
import { PaperBlock } from "./paper-block";
import { lineButtonId, noteFieldId, prefersReducedMotion, sceneDomId } from "./review-dom";
import type { CommentApi, MarginNote, PlacedFinding } from "./review-types";
import { SelectionControl } from "./selection-control";
import { useMarginLayout } from "./use-margin-layout";
import { useSelectionPicker } from "./use-selection-picker";
import { useSheetNotes } from "./use-sheet-notes";

const EMPTY_MARKS: MarkRange[] = [];
const EMPTY_CUTS: number[] = [];

/**
 * The whole script on one continuous paper: the title page, then every scene in order. Highlight
 * any passage (mouse or touch) to comment on exactly those characters; a keyboard user tabs to a
 * block's "Comment on this line". Commented passages are tinted on the paper. With room (about
 * 800px), comments and script checks sit in a margin beside the paper at the top of their
 * passage, stacked so they never overlap; with less, they sit under their block in a dark card.
 */
export function ReviewSheet({
  scenes,
  content,
  titlePage,
  findings,
  comments,
}: {
  scenes: Scene[];
  content: string;
  titlePage: { title: string; logline: string | null };
  findings: PlacedFinding[];
  /** Null on an older version: read only. */
  comments: CommentApi | null;
}) {
  const pendingFocus = useRef<string | null>(null);
  const apiRef = useRef(comments);
  const [active, setActive] = useState("");
  const commenting = comments !== null;
  const full = comments?.full ?? false;

  useEffect(() => {
    apiRef.current = comments;
  });
  const { blockAt, marksByBlock, cutsByBlock, notes, notesByBlock } = useSheetNotes(
    scenes,
    findings,
    comments,
  );
  const { wrapRef, articleRef, noteEls, wide, layout } = useMarginLayout(notes);

  // A new comment's field takes focus once it is in place.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    if (wide && !layout.tops.has(`comment-${id}`)) return;
    const field = document.getElementById(noteFieldId(id));
    if (!field) return;
    pendingFocus.current = null;
    field.focus({ preventScroll: true });
    field.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  });

  const [picked, setPicked] = useSelectionPicker(articleRef, commenting, content);

  const addComment = useCallback((range: { start: number; end: number; quote: string }) => {
    const api = apiRef.current;
    if (!api || api.full) return;
    const comment = api.add(range);
    pendingFocus.current = comment.id;
  }, []);

  const commentBlock = useCallback(
    (block: ScreenplayBlock) => {
      const range = trimRange(
        content,
        block.start,
        Math.min(block.end, block.start + MAX_QUOTE_CHARS),
      );
      if (range) addComment({ ...range, quote: content.slice(range.start, range.end) });
    },
    [content, addComment],
  );

  function commentSelection() {
    if (!picked?.passage.ok) return;
    const { start, end, quote } = picked.passage;
    addComment({ start, end, quote });
    document.getSelection()?.removeAllRanges();
    setPicked(null);
  }

  function removeComment(comment: DraftComment) {
    comments?.remove(comment.id);
    setActive("");
    // Back to the keyboard comment control of the block the passage starts in.
    const target = lineButtonId(blockAt(comment.start).start);
    requestAnimationFrame(() => document.getElementById(target)?.focus());
  }

  const activeCss = active
    .split(" ")
    .filter((id) => /^[\w-]+$/.test(id))
    .map((id) => `[data-c~="${id}"]`)
    .join(",");

  function card(note: MarginNote) {
    return (
      <NoteCard
        note={note}
        active={note.kind === "comment" && active.split(" ").includes(note.comment.id)}
        comments={comments}
        onActivate={setActive}
        onRemove={removeComment}
      />
    );
  }

  return (
    <div ref={wrapRef} className="flex flex-1 flex-col">
      {activeCss ? (
        <style>{`${activeCss}{background-color:color-mix(in srgb,var(--brand) 55%,transparent)}`}</style>
      ) : null}
      <article
        ref={articleRef}
        aria-label="Script"
        className={cn(
          "relative isolate flex flex-1 flex-col gap-6 py-11 font-script text-script text-ink",
          // The paper grows to 820px; the comment margin takes the rest (224px + the 32px gap).
          wide ? "[--sheet-w:min(51.25rem,100%_-_16rem)]" : "[--sheet-w:100%]",
        )}
        style={wide && layout.bottom > 0 ? { minHeight: layout.bottom + 44 } : undefined}
        onPointerOver={(event) => {
          const target = event.target;
          if (!(target instanceof Element) || target.closest("[data-note]")) return;
          setActive(target.closest<HTMLElement>("[data-c]")?.dataset.c ?? "");
        }}
        onPointerLeave={() => setActive("")}
      >
        <PaperLayers className="w-(--sheet-w)" />
        <div className={cn("w-(--sheet-w)", SHEET_X, ON_PAPER)}>
          <TitlePage title={titlePage.title} logline={titlePage.logline} />
        </div>

        {scenes.map((scene) => (
          <div
            key={scene.key}
            id={sceneDomId(scene)}
            tabIndex={-1}
            aria-label={sceneName(scene)}
            role="group"
            className="flex scroll-mt-[calc(var(--toolbar-h)+1.5rem)] flex-col gap-6 outline-none"
          >
            {scene.blocks.map((block) => {
              const below = wide ? undefined : notesByBlock.get(block.start);
              return (
                <div key={block.start} className="flex flex-col">
                  <PaperBlock
                    block={block}
                    marks={marksByBlock.get(block.start) ?? EMPTY_MARKS}
                    cuts={cutsByBlock.get(block.start) ?? EMPTY_CUTS}
                    canAdd={!full}
                    onComment={commenting ? commentBlock : null}
                  />
                  {below ? (
                    <div
                      data-note
                      className={cn(
                        SHEET_MX,
                        "mt-3 flex flex-col gap-3 rounded-tile bg-elevated p-3 font-sans text-body text-label",
                      )}
                    >
                      {below.map((n) => (
                        <div key={n.key}>{card(n)}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}

        {wide ? (
          <div className="absolute inset-y-0 right-0 left-[calc(var(--sheet-w)+2rem)] font-sans text-body text-label">
            {notes.map((n) => {
              const top = layout.tops.get(n.key);
              return (
                <div
                  key={n.key}
                  data-note
                  ref={(el) => {
                    if (el) noteEls.current.set(n.key, el);
                    else noteEls.current.delete(n.key);
                  }}
                  className="absolute inset-x-0 transition-[top] duration-(--dur-swap) ease-out"
                  style={{ top: top ?? 0, visibility: top === undefined ? "hidden" : undefined }}
                >
                  {card(n)}
                </div>
              );
            })}
          </div>
        ) : null}

        {picked ? (
          <SelectionControl picked={picked} full={full} onComment={commentSelection} />
        ) : null}
      </article>
    </div>
  );
}
