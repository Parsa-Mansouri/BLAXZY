import { describe, expect, it } from "vitest";
import {
  isSceneHeading,
  numberLines,
  planSegments,
  sliceLines,
  splitLines,
  type ScriptSegment,
} from "./script-lines";

function scene(n: number, paragraphs: number): string {
  const body = Array.from(
    { length: paragraphs },
    (_, i) =>
      `Action paragraph ${i + 1} of scene ${n}, with enough words to take some space on the page.`,
  ).join("\n\n");
  return `INT. ROOM ${n} - DAY\n\n${body}\n`;
}

function expectTiling(segments: ScriptSegment[], lineCount: number) {
  let expected = 1;
  segments.forEach((s, i) => {
    expect(s.index).toBe(i);
    expect(s.startLine).toBe(expected);
    expect(s.endLine).toBeGreaterThanOrEqual(s.startLine);
    expected = s.endLine + 1;
  });
  expect(expected).toBe(lineCount + 1);
}

describe("script lines", () => {
  it("detects scene headings", () => {
    expect(isSceneHeading("INT. KITCHEN - NIGHT")).toBe(true);
    expect(isSceneHeading("EXT. PIER - DUSK")).toBe(true);
    expect(isSceneHeading("INT./EXT. CAR - DAY")).toBe(true);
    expect(isSceneHeading("12 INT. HALL - DAY")).toBe(true);
    expect(isSceneHeading("Interesting things happen.")).toBe(false);
    expect(isSceneHeading("MARA")).toBe(false);
  });

  it("numbers and slices lines", () => {
    const lines = splitLines("a\r\nb\nc");
    expect(lines).toEqual(["a", "b", "c"]);
    expect(numberLines(lines)).toBe("1| a\n2| b\n3| c");
    expect(sliceLines(lines, 2, 3)).toBe("b\nc");
  });

  it("covers a long script with scene-aligned, bounded segments", () => {
    const content = ["FADE IN:", "", ...Array.from({ length: 12 }, (_, i) => scene(i + 1, 4))].join(
      "\n",
    );
    const lines = splitLines(content);
    const segments = planSegments(content, 1200);
    expectTiling(segments, lines.length);
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments.slice(1))
      expect(isSceneHeading(lines[s.startLine - 1] ?? "")).toBe(true);
    for (const s of segments)
      expect(sliceLines(lines, s.startLine, s.endLine).length).toBeLessThanOrEqual(1200);
    expect(planSegments(content, 1200)).toEqual(segments);
  });

  it("splits a single oversized scene at paragraph breaks", () => {
    const content = scene(1, 40);
    const lines = splitLines(content);
    const segments = planSegments(content, 1000);
    expectTiling(segments, lines.length);
    expect(segments.length).toBeGreaterThan(3);
  });

  it("never crosses an episode heading", () => {
    const content = ["EPISODE 1: ONE", scene(1, 1), "EPISODE 2: TWO", scene(2, 1)].join("\n");
    const lines = splitLines(content);
    const segments = planSegments(content, 100_000);
    expectTiling(segments, lines.length);
    expect(segments).toHaveLength(2);
    expect(lines[(segments[1]?.startLine ?? 0) - 1]).toBe("EPISODE 2: TWO");
  });

  it("handles scripts without headings and trailing blank lines", () => {
    const content = "Just prose.\n\nMore prose.\n\n\n\n";
    const segments = planSegments(content, 5000);
    expectTiling(segments, splitLines(content).length);
    expect(segments).toHaveLength(1);
  });
});
