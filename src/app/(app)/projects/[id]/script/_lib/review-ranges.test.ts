import { describe, expect, it } from "vitest";
import {
  nearestAtOrBefore,
  rangeFromHits,
  sceneInView,
  selectedPassage,
  splitSegments,
  stackTops,
  trimRange,
} from "./review-ranges";

describe("splitSegments", () => {
  it("returns the whole line when nothing is marked", () => {
    expect(splitSegments(10, 20, [])).toEqual([{ start: 10, end: 20, ids: [] }]);
  });

  it("cuts at a comment inside the line", () => {
    expect(splitSegments(0, 10, [{ id: "a", start: 3, end: 6 }])).toEqual([
      { start: 0, end: 3, ids: [] },
      { start: 3, end: 6, ids: ["a"] },
      { start: 6, end: 10, ids: [] },
    ]);
  });

  it("stacks overlapping comments", () => {
    const marks = [
      { id: "a", start: 2, end: 8 },
      { id: "b", start: 5, end: 12 },
    ];
    expect(splitSegments(0, 10, marks)).toEqual([
      { start: 0, end: 2, ids: [] },
      { start: 2, end: 5, ids: ["a"] },
      { start: 5, end: 8, ids: ["a", "b"] },
      { start: 8, end: 10, ids: ["b"] },
    ]);
  });

  it("marks a whole line covered by a comment that crosses lines", () => {
    expect(splitSegments(20, 30, [{ id: "a", start: 5, end: 50 }])).toEqual([
      { start: 20, end: 30, ids: ["a"] },
    ]);
  });

  it("adds extra cuts without ids and ignores marks outside the line", () => {
    expect(splitSegments(0, 10, [{ id: "x", start: 40, end: 50 }], [4, 0, 10, 99])).toEqual([
      { start: 0, end: 4, ids: [] },
      { start: 4, end: 10, ids: [] },
    ]);
  });

  it("returns nothing for an empty line", () => {
    expect(splitSegments(5, 5, [])).toEqual([]);
  });
});

describe("rangeFromHits", () => {
  it("reads a selection inside one segment", () => {
    expect(rangeFromHits([{ at: 100, length: 20, from: 3, to: 9 }])).toEqual({
      start: 103,
      end: 109,
    });
  });

  it("takes whole segments where the selection starts or ends outside them", () => {
    expect(
      rangeFromHits([
        { at: 10, length: 5, from: null, to: null },
        { at: 16, length: 8, from: null, to: 4 },
      ]),
    ).toEqual({ start: 10, end: 20 });
  });

  it("is null for a collapsed selection or no segments", () => {
    expect(rangeFromHits([{ at: 4, length: 5, from: 2, to: 2 }])).toBeNull();
    expect(rangeFromHits([])).toBeNull();
  });

  it("clamps offsets to the segment", () => {
    expect(rangeFromHits([{ at: 0, length: 5, from: -2, to: 99 }])).toEqual({ start: 0, end: 5 });
  });
});

describe("trimRange", () => {
  const text = "MARA\n  Wait.  \n\nGo.";
  it("drops whitespace and line breaks at either end", () => {
    expect(trimRange(text, 4, 15)).toEqual({ start: 7, end: 12 });
  });
  it("is null for whitespace only", () => {
    expect(trimRange(text, 14, 16)).toBeNull();
  });
});

describe("selectedPassage", () => {
  const script = "INT. ROOM - DAY\n\nMara waits.\n\nMARA\nGo.";

  it("quotes exactly the selected characters across blocks", () => {
    const start = script.indexOf("waits");
    const end = script.indexOf("Go") + 2;
    const passage = selectedPassage(
      script,
      [
        { at: script.indexOf("Mara"), length: 11, from: 5, to: null },
        { at: script.indexOf("MARA"), length: 4, from: null, to: null },
        { at: script.indexOf("Go"), length: 3, from: null, to: 2 },
      ],
      5000,
    );
    expect(passage).toEqual({ ok: true, start, end, quote: script.slice(start, end) });
  });

  it("refuses a passage over the limit", () => {
    expect(selectedPassage(script, [{ at: 0, length: 15, from: 0, to: 15 }], 10)).toEqual({
      ok: false,
      reason: "too-long",
      length: 15,
    });
  });

  it("ignores a selection of spaces", () => {
    expect(selectedPassage("a   b", [{ at: 0, length: 5, from: 1, to: 4 }], 10)).toBeNull();
  });
});

describe("nearestAtOrBefore", () => {
  it("finds the segment holding an offset", () => {
    expect(nearestAtOrBefore([0, 5, 9], 7)).toBe(1);
    expect(nearestAtOrBefore([0, 5, 9], 9)).toBe(2);
    expect(nearestAtOrBefore([3, 5], 1)).toBe(0);
    expect(nearestAtOrBefore([], 1)).toBe(-1);
  });
});

describe("stackTops", () => {
  it("keeps notes at their anchors when they fit", () => {
    expect(
      stackTops(
        [
          { anchor: 0, height: 40 },
          { anchor: 100, height: 40 },
        ],
        12,
      ),
    ).toEqual([0, 100]);
  });

  it("pushes close notes down without overlap, in anchor order", () => {
    expect(
      stackTops(
        [
          { anchor: 30, height: 50 },
          { anchor: 10, height: 40 },
          { anchor: 30, height: 20 },
        ],
        10,
      ),
    ).toEqual([60, 10, 120]);
  });
});

describe("sceneInView", () => {
  it("takes the first scene crossing the band, else keeps the last answer", () => {
    expect(sceneInView([false, true, true], 0)).toBe(1);
    expect(sceneInView([false, false], 1)).toBe(1);
  });
});
