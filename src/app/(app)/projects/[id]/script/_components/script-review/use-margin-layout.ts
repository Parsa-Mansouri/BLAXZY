import { useCallback, useLayoutEffect, useEffect, useRef, useState } from "react";
import { stackTops } from "../../_lib/review-ranges";
import type { MarginNote } from "./review-types";
import { anchorSpan } from "./selection";

/** Width of the sheet's container from which notes sit in a margin beside the paper. */
const WIDE_PX = 800;
/** Space between stacked margin notes (12px). */
const NOTE_GAP = 12;

/** Where the margin notes sit: wide mode follows the container width, then each note is placed. */
export function useMarginLayout(notes: MarginNote[]) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const noteEls = useRef(new Map<string, HTMLElement>());
  const [wide, setWide] = useState(false);
  const [layout, setLayout] = useState<{ tops: Map<string, number>; bottom: number }>({
    tops: new Map(),
    bottom: 0,
  });

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

  return { wrapRef, articleRef, noteEls, wide, layout };
}
