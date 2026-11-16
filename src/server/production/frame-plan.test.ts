import { describe, expect, it } from "vitest";
import {
  frameLabel,
  maxFramesFor,
  parseWindow,
  planFrames,
  windowLabel,
  type PlannedWindow,
} from "./frame-plan";

const win = (startS: number, endS: number, shot: number): PlannedWindow => ({
  label: windowLabel(startS, endS),
  startS,
  endS,
  shot,
});

const FOUR = [win(0, 4, 1), win(4, 9, 2), win(9, 12, 3), win(12, 15, 4)];

describe("parseWindow", () => {
  it("reads the window spellings blocks use", () => {
    expect(parseWindow("0-4s")).toEqual({ startS: 0, endS: 4 });
    expect(parseWindow("4.5-9s")).toEqual({ startS: 4.5, endS: 9 });
    expect(parseWindow(" 4 – 9 s ")).toEqual({ startS: 4, endS: 9 });
    expect(parseWindow("4s-9s")).toEqual({ startS: 4, endS: 9 });
  });
  it("refuses anything else", () => {
    for (const bad of ["", "4", "9-4s", "4-4s", "a-bs", "0-4s extra"]) {
      expect(parseWindow(bad)).toBeNull();
    }
  });
});

describe("frameLabel", () => {
  it("matches the owner's line", () => {
    expect(frameLabel("f07", 8, win(4, 9, 2))).toBe("FRAME f07 t=8.0s window 4-9s planned shot 2");
    expect(frameLabel("f01", 0.1, null)).toBe("FRAME f01 t=0.1s outside the planned windows");
  });
});

describe("planFrames", () => {
  it("takes first, middle and last of every window plus the start and the final frame", () => {
    const frames = planFrames({ durationS: 15, windows: FOUR, cuts: [] });
    const times = frames.map((f) => f.t);
    expect(times).toContain(0.1);
    expect(times).toContain(14.95);
    for (const w of FOUR) {
      expect(times).toContain(Math.round(((w.startS + w.endS) / 2) * 100) / 100);
      // the last window's edge (14.9) is merged into the final frame (14.95)
      if (w !== FOUR[3]) expect(times).toContain(Math.round((w.endS - 0.1) * 100) / 100);
    }
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(frames.map((f) => f.id)).toEqual(
      frames.map((_, i) => `f${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("adds one frame 0.3 s after each detected cut", () => {
    const frames = planFrames({
      durationS: 10,
      windows: [win(0, 10, 1)],
      cuts: [{ t: 4.2 }, { t: 7 }],
    });
    expect(frames.filter((f) => f.reason === "cut").map((f) => f.t)).toEqual([4.5, 7.3]);
  });

  it("ignores cuts outside the clip and non-finite times", () => {
    const frames = planFrames({
      durationS: 5,
      windows: [],
      cuts: [{ t: 5.5 }, { t: -1 }, { t: Number.NaN }],
    });
    expect(frames.map((f) => f.reason)).toEqual(["start", "end"]);
  });

  it("merges frames closer than 0.15 s, keeping the higher-ranked reason", () => {
    // A cut at 3.75 gives a frame at 4.05, 0.05 from the window edge at 4.1: the edge wins.
    const frames = planFrames({
      durationS: 10,
      windows: [win(0, 4, 1), win(4, 10, 2)],
      cuts: [{ t: 3.75 }],
    });
    const times = frames.map((f) => f.t);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(0.15);
    }
    expect(frames.find((f) => f.t === 4.1)?.reason).toBe("window_first");
    expect(frames.some((f) => f.t === 4.05)).toBe(false);
    expect(frames[0]).toMatchObject({ t: 0.1, reason: "start" });
  });

  it("labels each frame with its window and planned shot", () => {
    const frames = planFrames({ durationS: 15, windows: FOUR, cuts: [] });
    const f = frames.find((x) => x.t === 6.5);
    expect(f?.label).toBe(`FRAME ${f?.id} t=6.5s window 4-9s planned shot 2`);
    expect(frames.at(-1)?.window?.shot).toBe(4);
  });

  it("caps a clip of 15 s or less at 16 frames, dropping middles first", () => {
    const windows = Array.from({ length: 7 }, (_, i) => win(i * 2, i * 2 + 2, i + 1));
    const frames = planFrames({ durationS: 14, windows, cuts: [{ t: 3.1 }, { t: 9.4 }] });
    expect(frames.length).toBeLessThanOrEqual(16);
    expect(frames.some((f) => f.reason === "start")).toBe(true);
    expect(frames.some((f) => f.reason === "end")).toBe(true);
    expect(frames.filter((f) => f.reason === "cut")).toHaveLength(2);
    expect(frames.filter((f) => f.reason === "window_middle").length).toBeLessThan(7);
  });

  it("drops cut frames, then window edges, only after every middle is gone", () => {
    // One long window with 20 cuts: the middle goes first, the cut frames fill the cap.
    const many = planFrames({
      durationS: 15,
      windows: [win(0, 15, 1)],
      cuts: Array.from({ length: 20 }, (_, i) => ({ t: 0.5 + i * 0.7 })),
    });
    expect(many).toHaveLength(16);
    expect(many.filter((f) => f.reason === "window_middle")).toHaveLength(0);
    expect(many.filter((f) => f.reason === "cut")).toHaveLength(14);

    // Nine windows, a cut frame on each middle: the cut frames go before any window edge.
    const size = 15 / 9;
    const windows = Array.from({ length: 9 }, (_, i) => win(i * size, (i + 1) * size, i + 1));
    const cuts = windows.map((w) => ({ t: (w.startS + w.endS) / 2 - 0.3 }));
    const frames = planFrames({ durationS: 15, windows, cuts });
    expect(frames).toHaveLength(16);
    expect(frames.filter((f) => f.reason === "cut" || f.reason === "window_middle")).toHaveLength(
      0,
    );
    expect(frames[0]?.reason).toBe("start");
    expect(frames.at(-1)?.reason).toBe("end");
  });

  it("never drops the start and end frames, whatever the cap", () => {
    const windows = Array.from({ length: 40 }, (_, i) => win(i * 0.7, i * 0.7 + 0.7, i + 1));
    const frames = planFrames({ durationS: 28, windows, cuts: [] });
    expect(frames).toHaveLength(28);
    expect(frames[0]?.reason).toBe("start");
    expect(frames.at(-1)?.reason).toBe("end");
  });

  it("caps a 30 s clip at 28 frames and a longer one too", () => {
    expect(maxFramesFor(15)).toBe(16);
    expect(maxFramesFor(15.01)).toBe(28);
    expect(maxFramesFor(30)).toBe(28);
    expect(maxFramesFor(45)).toBe(28);
    const windows = Array.from({ length: 12 }, (_, i) => win(i * 2.5, i * 2.5 + 2.5, i + 1));
    const cuts = Array.from({ length: 10 }, (_, i) => ({ t: 2 + i * 2.7 }));
    expect(planFrames({ durationS: 30, windows, cuts }).length).toBeLessThanOrEqual(28);
  });

  it("with no windows still returns the start, the end and cut frames, unlabelled by window", () => {
    const frames = planFrames({ durationS: 6, windows: [], cuts: [{ t: 2 }] });
    expect(frames.map((f) => f.t)).toEqual([0.1, 2.3, 5.95]);
    expect(frames.every((f) => f.window === null)).toBe(true);
    expect(frames[0]?.label).toContain("outside the planned windows");
  });

  it("clamps windows that run past the clip and drops ones that start after it", () => {
    const frames = planFrames({ durationS: 5, windows: [win(0, 8, 1), win(6, 9, 2)], cuts: [] });
    expect(Math.max(...frames.map((f) => f.t))).toBe(4.95);
    expect(frames.some((f) => f.window?.shot === 2)).toBe(false);
  });

  it("returns nothing for a clip without duration", () => {
    expect(planFrames({ durationS: 0, windows: FOUR, cuts: [] })).toEqual([]);
    expect(planFrames({ durationS: Number.NaN, windows: FOUR, cuts: [] })).toEqual([]);
  });

  it("is deterministic and does not depend on the order of windows or cuts", () => {
    const a = planFrames({ durationS: 15, windows: FOUR, cuts: [{ t: 4.2 }, { t: 9.1 }] });
    const b = planFrames({
      durationS: 15,
      windows: [...FOUR].reverse(),
      cuts: [{ t: 9.1 }, { t: 4.2 }],
    });
    expect(b).toEqual(a);
  });
});
