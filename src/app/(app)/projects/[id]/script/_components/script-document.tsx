"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MessageSquarePlus } from "lucide-react";
import { cn } from "@/ui";
import { parseScreenplay, type ScreenplayLine, type ScreenplayLineType } from "../_lib/screenplay";

export interface DocumentHighlight {
  id: string;
  start: number;
  end: number;
  /** `comment`: a pending comment. `focus`: the passage the user just chose in the inspector. */
  kind: "comment" | "focus";
}

/** A passage the user picked to comment on, with where to show the composer. */
export interface PassagePick {
  start: number;
  end: number;
  quote: string;
  /** Position of the passage's bottom edge, relative to the document. */
  top: number;
  left: number;
}

export interface ScriptDocumentHandle {
  /** Scrolls the line holding `offset` into view and moves keyboard focus there. */
  reveal: (offset: number) => void;
  /** Moves keyboard focus to the line holding `offset`, without scrolling. */
  focusAt: (offset: number) => void;
}

const LINE_STYLES: Record<ScreenplayLineType, string> = {
  episode: "text-title-2 font-semibold tracking-normal uppercase",
  scene_heading: "font-semibold uppercase",
  action: "",
  character: "mx-auto w-full max-w-[34ch] text-center uppercase",
  parenthetical: "mx-auto w-full max-w-[26ch] text-center text-label-2",
  dialogue: "mx-auto w-full max-w-[34ch] text-center",
  transition: "text-right uppercase text-label-2",
};

/** Space above a line: more before headings, little between a cue and its dialogue. */
function spaceAbove(line: ScreenplayLine, index: number): string {
  if (index === 0) return "";
  if (line.type === "episode") return "mt-14";
  if (line.type === "scene_heading") return "mt-9";
  if (line.type === "character") return "mt-5";
  if (line.type === "transition") return "mt-5";
  if (line.breakBefore) return "mt-4";
  return "";
}

const HIGHLIGHT_STYLES: Record<DocumentHighlight["kind"], string> = {
  comment: "bg-selection text-label underline decoration-label-2 underline-offset-[0.22em]",
  focus: "bg-fill text-label",
};

/** The line's text, cut into plain runs and highlighted runs. */
function renderRuns(line: ScreenplayLine, highlights: DocumentHighlight[]): ReactNode {
  const inLine = highlights
    .filter((h) => h.end > line.start && h.start < line.end)
    .sort((a, b) => a.start - b.start || (a.kind === "focus" ? 1 : -1));
  if (inLine.length === 0) return line.text;
  const cuts = new Set<number>([line.start, line.end]);
  for (const h of inLine) {
    cuts.add(Math.max(h.start, line.start));
    cuts.add(Math.min(h.end, line.end));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const runs: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i] as number;
    const to = points[i + 1] as number;
    if (to <= from) continue;
    const text = line.text.slice(from - line.start, to - line.start);
    const covering = inLine.filter((h) => h.start <= from && h.end >= to);
    const top =
      covering.find((h) => h.kind === "focus") ?? covering.find((h) => h.kind === "comment");
    runs.push(
      top ? (
        <mark
          key={from}
          data-highlight={top.id}
          className={cn("rounded-control-inner", HIGHLIGHT_STYLES[top.kind])}
        >
          {text}
        </mark>
      ) : (
        <span key={from}>{text}</span>
      ),
    );
  }
  return runs;
}

/** Character offset in the script of a DOM point inside the document. */
function offsetOf(container: HTMLElement, node: Node, offset: number): number | null {
  if (!container.contains(node)) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const text = element?.closest<HTMLElement>("[data-start]");
  if (text) {
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(node, offset);
    return Number(text.dataset.start) + range.toString().length;
  }
  // A point between lines: snap to the nearest line text.
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const child = node.childNodes[offset];
  const next =
    child instanceof Element
      ? child.matches("[data-start]")
        ? child
        : child.querySelector("[data-start]")
      : null;
  if (next instanceof HTMLElement) return Number(next.dataset.start);
  const all = (node as Element).querySelectorAll<HTMLElement>("[data-start]");
  const last = all[all.length - 1];
  return last ? Number(last.dataset.start) + (last.textContent?.length ?? 0) : null;
}

export interface ScriptDocumentProps {
  content: string;
  highlights?: DocumentHighlight[];
  /** Turns on commenting: selecting text or pressing Enter on a line offers a comment. */
  onPick?: (pick: PassagePick) => void;
  /** Rendered over the document (the comment composer). */
  overlay?: ReactNode;
  className?: string;
  "aria-label"?: string;
}

/**
 * The screenplay as a document. Lines carry their offsets so a selection maps to the exact
 * characters of the script. With `onPick`, the arrow keys move between lines and Enter (or the
 * Comment button at the line's edge) comments on the whole line.
 */
export const ScriptDocument = forwardRef<ScriptDocumentHandle, ScriptDocumentProps>(
  function ScriptDocument(
    { content, highlights = [], onPick, overlay, className, "aria-label": ariaLabel },
    ref,
  ) {
    const lines = useMemo(() => parseScreenplay(content), [content]);
    const container = useRef<HTMLDivElement>(null);
    const [activeLine, setActiveLine] = useState(0);
    const [selection, setSelection] = useState<PassagePick | null>(null);
    const commentable = Boolean(onPick);

    const lineElement = (index: number) =>
      container.current?.querySelector<HTMLElement>(`[data-line="${index}"]`) ?? null;

    useImperativeHandle(ref, () => ({
      focusAt(offset: number) {
        if (!commentable) return;
        const index = lines.findIndex((l) => l.end >= offset);
        const at = index === -1 ? lines.length - 1 : index;
        setActiveLine(at);
        lineElement(at)?.focus({ preventScroll: true });
      },
      reveal(offset: number) {
        const index = lines.findIndex((l) => l.end >= offset);
        const target = lineElement(index === -1 ? lines.length - 1 : index);
        if (!target) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        if (commentable) {
          setActiveLine(index === -1 ? lines.length - 1 : index);
          target.focus({ preventScroll: true });
        }
      },
    }));

    // Follows the text selection inside the document and offers "Add Comment" under it.
    const readSelection = useCallback(() => {
      const root = container.current;
      const sel = window.getSelection();
      if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }
      const a = offsetOf(root, range.startContainer, range.startOffset);
      const b = offsetOf(root, range.endContainer, range.endOffset);
      if (a === null || b === null) {
        setSelection(null);
        return;
      }
      let start = Math.min(a, b);
      let end = Math.max(a, b);
      while (start < end && /\s/.test(content[start] ?? "")) start++;
      while (end > start && /\s/.test(content[end - 1] ?? "")) end--;
      if (end <= start) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      setSelection({
        start,
        end,
        quote: content.slice(start, end),
        top: rect.bottom - box.top,
        left: rect.left - box.left,
      });
    }, [content]);

    useEffect(() => {
      if (!commentable) return;
      let frame = 0;
      const onChange = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(readSelection);
      };
      document.addEventListener("selectionchange", onChange);
      return () => {
        cancelAnimationFrame(frame);
        document.removeEventListener("selectionchange", onChange);
      };
    }, [commentable, readSelection]);

    function pickLine(index: number) {
      const line = lines[index];
      const el = lineElement(index);
      const root = container.current;
      if (!line || !el || !root || !onPick) return;
      const rect = el.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      onPick({
        start: line.start,
        end: line.end,
        quote: line.text,
        top: rect.bottom - box.top,
        left: 0,
      });
    }

    function onLineKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
      if (event.target !== event.currentTarget) return;
      const move = (to: number) => {
        event.preventDefault();
        const next = Math.max(0, Math.min(lines.length - 1, to));
        setActiveLine(next);
        lineElement(next)?.focus();
      };
      if (event.key === "ArrowDown") move(index + 1);
      else if (event.key === "ArrowUp") move(index - 1);
      else if (event.key === "Home") move(0);
      else if (event.key === "End") move(lines.length - 1);
      else if (event.key === "Enter") {
        event.preventDefault();
        pickLine(index);
      }
    }

    return (
      <div
        ref={container}
        aria-label={ariaLabel}
        role={commentable ? "group" : undefined}
        className={cn(
          "relative text-script text-label",
          commentable && "pl-9 max-sm:pl-7",
          className,
        )}
      >
        {lines.length === 0 ? (
          <p className="text-label-2">This version has no text.</p>
        ) : (
          lines.map((line, index) => (
            <div
              key={line.start}
              data-line={index}
              tabIndex={commentable ? (index === activeLine ? 0 : -1) : undefined}
              onFocus={commentable ? () => setActiveLine(index) : undefined}
              onKeyDown={commentable ? (e) => onLineKeyDown(e, index) : undefined}
              className={cn(
                "group/line relative rounded-control-inner break-words whitespace-pre-wrap",
                commentable && "-mx-1.5 px-1.5 outline-none focus-visible:bg-fill-4",
                spaceAbove(line, index),
              )}
            >
              <span data-start={line.start} className={cn("block", LINE_STYLES[line.type])}>
                {renderRuns(line, highlights)}
              </span>
              {commentable ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Comment on This Line"
                  title="Comment on This Line"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickLine(index)}
                  className={cn(
                    "absolute top-0 -left-9 flex size-(--control-h) items-center justify-center rounded-control text-label-2 opacity-0 max-sm:-left-7",
                    "transition-opacity duration-(--dur-fast) group-hover/line:opacity-100 group-focus-visible/line:opacity-100 hover:bg-fill-4 hover:text-label",
                    "[@media(pointer:coarse)]:hidden",
                  )}
                >
                  <MessageSquarePlus aria-hidden="true" className="size-(--icon)" />
                </button>
              ) : null}
            </div>
          ))
        )}

        {commentable && selection ? (
          <div
            className="absolute z-10"
            style={{
              top: selection.top + 6,
              left: `clamp(0px, ${selection.left}px, calc(100% - 8rem))`,
            }}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick?.(selection);
                setSelection(null);
              }}
              className="inline-flex h-(--control-h) items-center gap-1.5 rounded-capsule bg-elevated-2 px-3 text-body font-medium text-label shadow-float focus-ring hover:bg-elevated-3"
            >
              <MessageSquarePlus aria-hidden="true" className="size-(--icon-sm)" />
              Add Comment
            </button>
          </div>
        ) : null}
        {overlay}
      </div>
    );
  },
);
