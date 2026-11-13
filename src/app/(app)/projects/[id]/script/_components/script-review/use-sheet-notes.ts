import { useCallback, useMemo } from "react";
import { blockIndexAt, type Scene, type ScreenplayBlock } from "../../_lib/scenes";
import type { MarkRange } from "../../_lib/review-ranges";
import type { CommentApi, MarginNote, PlacedFinding } from "./review-types";

/** What the sheet derives from the script and its comments: blocks, tint ranges, margin notes. */
export function useSheetNotes(
  scenes: Scene[],
  findings: PlacedFinding[],
  comments: CommentApi | null,
) {
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

  return { blockAt, marksByBlock, cutsByBlock, notes, notesByBlock };
}
