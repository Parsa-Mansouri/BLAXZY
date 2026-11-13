import { useEffect, useState, type RefObject } from "react";
import type { Picked } from "./review-types";
import { readSelection } from "./selection";

/** The floating Comment control follows the selection on the paper. */
export function useSelectionPicker(
  articleRef: RefObject<HTMLElement | null>,
  commenting: boolean,
  content: string,
) {
  const [picked, setPicked] = useState<Picked | null>(null);

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
  }, [articleRef, commenting, content]);

  return [picked, setPicked] as const;
}
