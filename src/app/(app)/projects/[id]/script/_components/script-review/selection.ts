import { nearestAtOrBefore, selectedPassage, type SegmentHit } from "../../_lib/review-ranges";
import { MAX_QUOTE_CHARS } from "../review-comments";
import type { Picked } from "./review-types";

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
export function readSelection(root: HTMLElement, content: string): Picked | null {
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
export function anchorSpan(
  spans: HTMLElement[],
  ats: number[],
  anchor: number,
): HTMLElement | undefined {
  let i = nearestAtOrBefore(ats, anchor);
  const span = spans[i];
  // In the whitespace between lines: the next line is where the passage starts.
  if (span && (ats[i] as number) + (span.textContent?.length ?? 0) <= anchor) {
    i = Math.min(i + 1, spans.length - 1);
  }
  return spans[i];
}
