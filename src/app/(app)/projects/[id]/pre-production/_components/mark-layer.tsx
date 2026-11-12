"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { cn } from "@/ui";
import {
  MAX_MARKS,
  NUDGE,
  NUDGE_FAR,
  clamp01,
  nudgeMark,
  regionWords,
  type Mark,
} from "../_lib/marks";

/** The marks on a picture, shared by the layer on the picture and the list in the panel. */
export interface Marking {
  marks: Mark[];
  /** The mark being pointed at or edited: its pin and its row light up together. */
  active: string | null;
  setActive: (id: string | null) => void;
  /** Adds a mark (centre by default) and returns its id, or null when there is no room. */
  add: (at?: { x: number; y: number }) => string | null;
  move: (id: string, x: number, y: number) => void;
  setText: (id: string, text: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

let counter = 0;

/** The marks' state. Lives with the picture's stage, so the layer and the panel share it. */
export function useMarking(): Marking {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const count = marks.length;

  const add = useCallback(
    (at?: { x: number; y: number }) => {
      if (count >= MAX_MARKS) return null;
      counter += 1;
      const id = `m${counter}`;
      const mark: Mark = { id, x: clamp01(at?.x ?? 0.5), y: clamp01(at?.y ?? 0.5), text: "" };
      setMarks((list) => (list.length >= MAX_MARKS ? list : [...list, mark]));
      setActive(id);
      return id;
    },
    [count],
  );
  const move = useCallback((id: string, x: number, y: number) => {
    setMarks((list) => list.map((m) => (m.id === id ? { ...m, x: clamp01(x), y: clamp01(y) } : m)));
  }, []);
  const setText = useCallback((id: string, text: string) => {
    setMarks((list) => list.map((m) => (m.id === id ? { ...m, text } : m)));
  }, []);
  const remove = useCallback((id: string) => {
    setMarks((list) => list.filter((m) => m.id !== id));
    setActive((a) => (a === id ? null : a));
  }, []);
  const clear = useCallback(() => {
    setMarks([]);
    setActive(null);
  }, []);

  return useMemo(
    () => ({ marks, active, setActive, add, move, setText, remove, clear }),
    [marks, active, add, move, setText, remove, clear],
  );
}

/** DOM ids, so the pin and its row can hand focus to each other. */
export const markPinId = (id: string) => `mark-pin-${id}`;
export const markFieldId = (id: string) => `mark-field-${id}`;

/** Focuses an element once it has rendered, without scrolling the page. */
export function focusSoon(elementId: string) {
  requestAnimationFrame(() => document.getElementById(elementId)?.focus({ preventScroll: true }));
}

/** Pointer travel (px) before a press on a pin becomes a drag. */
const DRAG_SLOP = 4;

/** A brand marker with its number, centred on the spot it marks. */
function Pin({
  mark,
  n,
  active,
  disabled,
  subject,
  marking,
  layer,
}: {
  mark: Mark;
  n: number;
  active: boolean;
  disabled: boolean;
  subject: "image" | "sheet";
  marking: Marking;
  layer: () => DOMRect | null;
}) {
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    marking.setActive(mark.id);
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    const rect = layer();
    if (!d || !rect) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_SLOP) return;
    d.moved = true;
    marking.move(
      mark.id,
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    );
  }

  function onPointerUp(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // A press without a drag opens the mark's comment (not on touch: no keyboard pop-up).
    if (d && !d.moved && e.pointerType === "mouse") focusSoon(markFieldId(mark.id));
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const step = e.shiftKey ? NUDGE_FAR : NUDGE;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[e.key];
    if (move) {
      e.preventDefault();
      const next = nudgeMark(mark, move[0], move[1]);
      marking.move(mark.id, next.x, next.y);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      marking.remove(mark.id);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      focusSoon(markFieldId(mark.id));
    }
  }

  return (
    <button
      type="button"
      id={markPinId(mark.id)}
      disabled={disabled}
      aria-label={`Mark ${n}, ${regionWords(mark.x, mark.y)} of the ${subject}. Arrow keys move it, Enter edits its comment, Delete removes it.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      onFocus={() => marking.setActive(mark.id)}
      onPointerEnter={() => marking.setActive(mark.id)}
      style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
      className={cn(
        "absolute z-10 flex size-7 -translate-x-1/2 -translate-y-1/2 swap-in cursor-grab touch-none items-center justify-center rounded-inset bg-brand font-mono text-meta font-semibold text-ground tabular-nums outline-none select-none active:cursor-grabbing",
        "ring-2 ring-ground/70 transition-[box-shadow,scale] duration-(--dur-press) motion-reduce:transition-none",
        "focus-visible:ring-label",
        active && "scale-110 ring-label",
      )}
    >
      {n}
    </button>
  );
}

/**
 * The marking layer over the picture while asking for changes: a click or tap drops a numbered
 * pin there, pins drag to a new spot, and the keyboard moves the focused pin. Each pin's comment
 * is written in the panel. Rendered inside `FitToImage`, so it covers exactly the picture.
 */
export function MarkLayer({
  marking,
  subject,
  disabled = false,
}: {
  marking: Marking;
  subject: "image" | "sheet";
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const full = marking.marks.length >= MAX_MARKS;
  const layer = () => ref.current?.getBoundingClientRect() ?? null;

  function drop(e: MouseEvent<HTMLDivElement>) {
    const rect = layer();
    if (disabled || full || !rect) return;
    const id = marking.add({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
    // With a mouse, go straight to the comment; a tap leaves the keyboard closed.
    const touch = "pointerType" in e.nativeEvent && e.nativeEvent.pointerType !== "mouse";
    if (id && !touch) focusSoon(markFieldId(id));
  }

  return (
    <div
      ref={ref}
      // The pins and the panel's "Add a mark" are the accessible way in; this is the mouse's.
      aria-hidden={marking.marks.length === 0 ? true : undefined}
      onClick={drop}
      onPointerLeave={() => marking.setActive(null)}
      className={cn(
        "absolute inset-0 swap-in ring-1 ring-brand/60 ring-inset",
        !disabled && !full && "cursor-crosshair",
      )}
    >
      {marking.marks.length === 0 && !disabled ? (
        <span className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-inset bg-ground/75 px-2.5 py-1 font-mono text-meta tracking-caps whitespace-nowrap text-label uppercase">
          Click or tap to mark a spot
        </span>
      ) : null}
      {marking.marks.map((mark, i) => (
        <Pin
          key={mark.id}
          mark={mark}
          n={i + 1}
          active={marking.active === mark.id}
          disabled={disabled}
          subject={subject}
          marking={marking}
          layer={layer}
        />
      ))}
    </div>
  );
}
