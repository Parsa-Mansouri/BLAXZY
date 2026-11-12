"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { Button, PageHeader, StatusLine, cn, useToast } from "@/ui";
import {
  nearestAtOrBefore,
  sceneInView,
  selectedPassage,
  splitSegments,
  stackTops,
  trimRange,
  type MarkRange,
  type SegmentHit,
  type SelectedPassage,
} from "../_lib/review-ranges";
import {
  blockIndexAt,
  sceneIndexAt,
  splitScenes,
  type Scene,
  type ScreenplayBlock,
} from "../_lib/scenes";
import { findQuote, type ScreenplayLine } from "../_lib/screenplay";
import { submitReviewAction } from "../actions";
import { ApplyCommentsDock } from "./apply-comments-dock";
import { RequestChangesSheet } from "./request-changes-sheet";
import {
  LineComment,
  MAX_COMMENT_CHARS,
  MAX_QUOTE_CHARS,
  isSendable,
  useDraftComments,
  type DraftComment,
} from "./review-comments";
import {
  BlockText,
  ON_PAPER,
  PaperLayers,
  SHEET_MX,
  SHEET_RIGHT,
  SHEET_X,
  TitlePage,
} from "./screenplay-sheet";
import {
  FindingNote,
  SAMPLE_LINE,
  SceneList,
  VersionNotes,
  VersionTabs,
  sceneName,
  useVersionViewer,
  type Finding,
  type VersionSummary,
  type VersionView,
} from "./shared";

/** Width of the sheet's container from which notes sit in a margin beside the paper. */
const WIDE_PX = 800;
/** Space between stacked margin notes (12px). */
const NOTE_GAP = 12;
const EMPTY_MARKS: MarkRange[] = [];
const EMPTY_CUTS: number[] = [];

const sceneDomId = (scene: Scene) => `scene-${scene.key}`;
const lineButtonId = (blockStart: number) => `comment-on-${blockStart}`;
const noteFieldId = (commentId: string) => `comment-note-${commentId}`;
const quoteId = (commentId: string) => `comment-quote-${commentId}`;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface PlacedFinding {
  finding: Finding;
  key: string;
  /** Offset of the passage the finding quotes. */
  start: number;
}

/** Findings that quote a passage go beside it; the rest are about the whole script. */
function placeFindings(content: string, findings: Finding[] | null) {
  const placed: PlacedFinding[] = [];
  const loose: Finding[] = [];
  (findings ?? []).forEach((finding, i) => {
    const range = finding.quote ? findQuote(content, finding.quote) : null;
    if (range) placed.push({ finding, key: `finding-${i}`, start: range.start });
    else loose.push(finding);
  });
  return { placed, loose };
}

interface CommentApi {
  comments: DraftComment[];
  full: boolean;
  add: (range: { start: number; end: number; quote: string }) => DraftComment;
  update: (id: string, note: string) => void;
  remove: (id: string) => void;
}

type MarginNote =
  | { kind: "finding"; key: string; anchor: number; finding: Finding }
  | { kind: "comment"; key: string; anchor: number; comment: DraftComment };

/** Where the floating Comment control sits (relative to the sheet) and what it would do. */
interface Picked {
  passage: SelectedPassage;
  top: number;
  left: number;
}

/** Where a selection boundary falls inside one rendered segment (null: outside it). */
function pointIn(span: HTMLElement, node: Node, offset: number, length: number): number | null {
  if (!span.contains(node)) return null;
  if (node.nodeType === Node.TEXT_NODE) return offset;
  // A boundary on the span element itself: before or after its one text node.
  return offset === 0 ? 0 : length;
}

/**
 * The current selection as a passage of the script, read from the segments it touches (each
 * `[data-at]` span holds exactly `content.slice(at, at + text.length)`). Selections that start
 * or end outside the paper are cut to the text on it; title-page and margin text is ignored.
 */
function readSelection(root: HTMLElement, content: string): Picked | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const focused = document.activeElement;
  if (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) return null;
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(root)) return null;

  const hits: SegmentHit[] = [];
  let lastSpan: HTMLElement | null = null;
  for (const span of root.querySelectorAll<HTMLElement>("[data-at]")) {
    if (!range.intersectsNode(span)) {
      if (hits.length > 0) break;
      continue;
    }
    const length = span.textContent?.length ?? 0;
    hits.push({
      at: Number(span.dataset.at),
      length,
      from: pointIn(span, range.startContainer, range.startOffset, length),
      to: pointIn(span, range.endContainer, range.endOffset, length),
    });
    lastSpan = span;
  }
  const passage = selectedPassage(content, hits, MAX_QUOTE_CHARS);
  if (!passage || !lastSpan) return null;

  // Under the end of the selection, kept on the block's width.
  const end = document.createRange();
  end.selectNodeContents(lastSpan);
  if (lastSpan.contains(range.endContainer)) end.setEnd(range.endContainer, range.endOffset);
  const rects = Array.from(end.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  const last = rects[rects.length - 1] ?? lastSpan.getBoundingClientRect();
  const box = root.getBoundingClientRect();
  const block = (lastSpan.closest("[data-block]") ?? root).getBoundingClientRect();
  const inset = 64;
  const x = Math.min(Math.max(last.right, block.left + inset), block.right - inset);
  return { passage, top: last.bottom - box.top + 6, left: x - box.left };
}

/** The span (rendered segment) a note's anchor offset falls in, for measuring its top. */
function anchorSpan(spans: HTMLElement[], ats: number[], anchor: number): HTMLElement | undefined {
  let i = nearestAtOrBefore(ats, anchor);
  const span = spans[i];
  // In the whitespace between lines: the next line is where the passage starts.
  if (span && (ats[i] as number) + (span.textContent?.length ?? 0) <= anchor) {
    i = Math.min(i + 1, spans.length - 1);
  }
  return spans[i];
}

/**
 * One block of the script on the paper, its lines split into segments at comment and finding
 * boundaries. Memoised: typing in a comment does not re-render the script.
 */
const PaperBlock = memo(function PaperBlock({
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

/** A note beside (or under) the text: a script check, or one of the reviewer's comments. */
function NoteCard({
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

/**
 * The whole script on one continuous paper: the title page, then every scene in order. Highlight
 * any passage (mouse or touch) to comment on exactly those characters; a keyboard user tabs to a
 * block's "Comment on this line". Commented passages are tinted on the paper. With room (about
 * 800px), comments and script checks sit in a margin beside the paper at the top of their
 * passage, stacked so they never overlap; with less, they sit under their block in a dark card.
 */
function ReviewSheet({
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const noteEls = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const apiRef = useRef(comments);
  const [wide, setWide] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [active, setActive] = useState("");
  const [layout, setLayout] = useState<{ tops: Map<string, number>; bottom: number }>({
    tops: new Map(),
    bottom: 0,
  });
  const commenting = comments !== null;
  const full = comments?.full ?? false;

  useEffect(() => {
    apiRef.current = comments;
  });

  const blocks = useMemo(() => scenes.flatMap((s) => s.blocks), [scenes]);
  const blockAt = useCallback(
    (offset: number) => blocks[blockIndexAt(blocks, offset)] as ScreenplayBlock,
    [blocks],
  );

  // Comment ranges, stable while only the notes change (so typing does not re-render the text).
  const markKey = (comments?.comments ?? []).map((c) => `${c.id}:${c.start}:${c.end}`).join("|");
  const marks = useMemo<MarkRange[]>(
    () =>
      markKey === ""
        ? []
        : markKey.split("|").map((part) => {
            const [id = "", start = "0", end = "0"] = part.split(":");
            return { id, start: Number(start), end: Number(end) };
          }),
    [markKey],
  );
  const marksByBlock = useMemo(() => {
    const map = new Map<number, MarkRange[]>();
    for (const b of blocks) {
      const own = marks.filter((m) => m.start < b.end && m.end > b.start);
      if (own.length > 0) map.set(b.start, own);
    }
    return map;
  }, [blocks, marks]);
  const cutsByBlock = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const f of findings) {
      const b = blocks[blockIndexAt(blocks, f.start)];
      if (b) map.set(b.start, [...(map.get(b.start) ?? []), f.start]);
    }
    return map;
  }, [blocks, findings]);

  const notes = useMemo<MarginNote[]>(() => {
    const list: MarginNote[] = findings.map((f) => ({
      kind: "finding",
      key: f.key,
      anchor: f.start,
      finding: f.finding,
    }));
    for (const c of comments?.comments ?? []) {
      list.push({ kind: "comment", key: `comment-${c.id}`, anchor: c.start, comment: c });
    }
    return list.sort((a, b) => a.anchor - b.anchor);
  }, [findings, comments?.comments]);

  const notesByBlock = useMemo(() => {
    const map = new Map<number, MarginNote[]>();
    for (const n of notes) {
      const b = blockAt(n.anchor);
      map.set(b.start, [...(map.get(b.start) ?? []), n]);
    }
    return map;
  }, [notes, blockAt]);

  // Margin mode follows the width of the sheet's container, not the window.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= WIDE_PX);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Margin notes: each at the top of its passage, pushed down past the one above it.
  const measure = useCallback(() => {
    const root = articleRef.current;
    if (!root || !wide) return;
    const box = root.getBoundingClientRect();
    const spans = Array.from(root.querySelectorAll<HTMLElement>("[data-at]"));
    const ats = spans.map((s) => Number(s.dataset.at));
    const items = notes.map((n) => {
      const span = anchorSpan(spans, ats, n.anchor);
      return {
        anchor: span ? span.getBoundingClientRect().top - box.top : 0,
        height: noteEls.current.get(n.key)?.offsetHeight ?? 0,
      };
    });
    const tops = stackTops(items, NOTE_GAP);
    const next = new Map<string, number>();
    let bottom = 0;
    notes.forEach((n, i) => {
      const top = Math.round(tops[i] ?? 0);
      next.set(n.key, top);
      bottom = Math.max(bottom, top + (items[i]?.height ?? 0));
    });
    setLayout((prev) => {
      const same =
        prev.bottom === bottom &&
        prev.tops.size === next.size &&
        [...next].every(([k, v]) => prev.tops.get(k) === v);
      return same ? prev : { tops: next, bottom };
    });
  }, [notes, wide]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const root = articleRef.current;
    if (!root || !wide) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(root);
    for (const el of noteEls.current.values()) observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [measure, wide]);

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

  // The floating Comment control follows the selection on the paper.
  useEffect(() => {
    const root = articleRef.current;
    if (!root || !commenting) return;
    let frame = 0;
    let dragging = false;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPicked(readSelection(root, content)));
    };
    const onSelection = () => {
      if (!dragging) read();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-selection-ui]")) return;
      dragging = true;
      setPicked(null);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      read();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicked(null);
    };
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.removeEventListener("keydown", onKey);
    };
  }, [commenting, content]);

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
                onClick={commentSelection}
              >
                Comment
              </Button>
            )}
          </div>
        ) : null}
      </article>
    </div>
  );
}

/** The scene outline (wide screens) beside one long sheet, for one version. */
function ReviewBody({
  version,
  fallbackTitle,
  comments,
}: {
  version: VersionView;
  fallbackTitle: string;
  comments: CommentApi | null;
}) {
  const content = version.content ?? "";
  const scenes = useMemo(() => splitScenes(content), [content]);
  const { placed, loose } = useMemo(
    () => placeFindings(content, version.findings),
    [content, version.findings],
  );
  const [current, setCurrent] = useState(0);

  // The scene in view: the first one crossing a band just under the toolbar.
  useEffect(() => {
    if (scenes.length < 2) return;
    const elements = scenes
      .map((s) => document.getElementById(sceneDomId(s)))
      .filter((el): el is HTMLElement => el !== null);
    const flags = elements.map(() => false);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const i = elements.indexOf(entry.target as HTMLElement);
          if (i !== -1) flags[i] = entry.isIntersecting;
        }
        setCurrent((prev) => sceneInView(flags, prev));
      },
      { rootMargin: "-96px 0px -70% 0px" },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [scenes]);

  function jump(index: number) {
    const scene = scenes[index];
    const el = scene ? document.getElementById(sceneDomId(scene)) : null;
    if (!el) return;
    setCurrent(index);
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }

  const counts = scenes.map((_, i) => {
    const checks = placed.filter((f) => sceneIndexAt(scenes, f.start) === i).length;
    const notes =
      comments?.comments.filter((c) => isSendable(c) && sceneIndexAt(scenes, c.start) === i)
        .length ?? 0;
    return checks + notes;
  });

  return (
    <div className="flex flex-1 in-3 gap-12">
      {scenes.length > 1 ? (
        <aside className="hidden w-44 shrink-0 xl:block 2xl:w-60">
          <div className="sticky top-[calc(var(--toolbar-h)+1.5rem)] -m-1 max-h-[calc(100dvh-var(--toolbar-h)-3rem)] overflow-y-auto p-1">
            <SceneList scenes={scenes} index={current} onSelect={jump} counts={counts} />
          </div>
        </aside>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {scenes.length > 0 ? (
          <ReviewSheet
            scenes={scenes}
            content={content}
            titlePage={{ title: version.title ?? fallbackTitle, logline: version.logline }}
            findings={placed}
            comments={comments}
          />
        ) : (
          <p className="text-body text-label-2">This version has no text.</p>
        )}
        <VersionNotes version={version} looseFindings={loose} />
      </div>
    </div>
  );
}

export function ScriptReview({
  projectId,
  fallbackTitle,
  version,
  versions,
  sample,
}: {
  projectId: string;
  fallbackTitle: string;
  version: VersionView;
  versions: VersionSummary[];
  sample: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const content = version.content ?? "";
  const drafts = useDraftComments(version.id, content);
  const viewer = useVersionViewer(projectId, version.id);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sending, startSending] = useTransition();
  const [accepting, startAccepting] = useTransition();
  const [applying, startApplying] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const shown = viewer.viewing ?? version;
  const readOnly = viewer.viewing !== null;
  const sendable = drafts.comments.filter(isSendable);

  function accept() {
    setError(null);
    startAccepting(async () => {
      const result = await submitReviewAction(projectId, version.id, { decision: "accepted" });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      drafts.clear();
      toast.success("Script accepted.");
      router.refresh();
    });
  }

  function submitRejection(
    extra: { issueCodes?: string[]; note?: string },
    run: typeof startSending,
    fail: (message: string) => void,
    done: () => void,
    success: string,
  ) {
    if (drafts.comments.some((c) => c.note.trim().length > MAX_COMMENT_CHARS)) {
      fail("One of your comments is over 4,000 characters. Shorten it first.");
      return;
    }
    run(async () => {
      const result = await submitReviewAction(projectId, version.id, {
        decision: "rejected",
        ...extra,
        comments: sendable.map(({ quote, start, end, note }) => ({
          quote,
          start,
          end,
          note: note.trim(),
        })),
      });
      if (!result.ok) {
        fail(result.error);
        return;
      }
      drafts.clear();
      done();
      toast.success(success);
      router.refresh();
    });
  }

  function requestChanges(input: { issueCodes: string[]; note: string }) {
    setSheetError(null);
    submitRejection(
      { issueCodes: input.issueCodes, note: input.note || undefined },
      startSending,
      setSheetError,
      () => setSheetOpen(false),
      "Changes requested.",
    );
  }

  function applyComments() {
    setApplyError(null);
    submitRejection({}, startApplying, setApplyError, () => {}, "Applying your comments.");
  }

  const showDock = !readOnly && sendable.length > 0;

  return (
    <>
      <PageHeader
        title="Script"
        description="Highlight any passage to comment on it and apply your comments, or accept the script or request general changes."
        actions={
          <>
            <Button
              variant="outlined"
              size="large"
              onClick={() => {
                setSheetError(null);
                setSheetOpen(true);
              }}
              disabled={readOnly || accepting || applying}
            >
              Request Changes
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={accept}
              loading={accepting}
              disabled={readOnly || sending || applying}
            >
              Accept Script
            </Button>
          </>
        }
      />
      {error ? (
        <p role="alert" className="-mt-4 mb-6 text-secondary text-red">
          {error}
        </p>
      ) : null}
      {sample || shown.isSample ? (
        <StatusLine className="mb-6 in-1">{SAMPLE_LINE}</StatusLine>
      ) : null}

      <VersionTabs versions={versions} shownId={shown.id} viewer={viewer} />

      <div className={cn("flex flex-1 flex-col", showDock && "pb-28")}>
        <ReviewBody
          key={shown.id}
          version={shown}
          fallbackTitle={fallbackTitle}
          comments={readOnly ? null : drafts}
        />
      </div>

      {showDock ? (
        <ApplyCommentsDock
          count={sendable.length}
          applying={applying}
          disabled={sending || accepting}
          error={applyError}
          onApply={applyComments}
        />
      ) : null}

      <RequestChangesSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!sending) setSheetOpen(open);
        }}
        commentCount={sendable.length}
        sending={sending}
        serverError={sheetError}
        onSubmit={requestChanges}
      />
    </>
  );
}
