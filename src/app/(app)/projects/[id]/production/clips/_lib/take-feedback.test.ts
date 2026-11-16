import { describe, expect, it } from "vitest";
import type { TakeReviewView } from "@/server/production";
import {
  changeRequest,
  hasRequest,
  MAX_TIMED_NOTES,
  normalizeRange,
  rangeLabel,
  standing,
  toggled,
  withTimedNote,
  type TimedNote,
} from "./take-feedback";

const review: TakeReviewView = {
  state: "ready",
  findings: [
    { id: "i1", label: "A hand has six fingers.", fromS: 2, toS: 3, severity: "major" },
    { id: "i2", label: "The door is closed.", fromS: 0, toS: 4, severity: "minor" },
  ],
  keeps: [
    { id: "k1", label: "Shot 1 looks as planned.", window: "0-4s" },
    { id: "k2", label: "The light is right.", window: "4-9s" },
  ],
};

describe("rangeLabel", () => {
  it("names a range and a moment", () => {
    expect(rangeLabel(2, 5.4)).toBe("0:02.0 to 0:05.4");
    expect(rangeLabel(3, 3)).toBe("at 0:03.0");
  });
});

describe("toggled", () => {
  it("adds and removes without changing the original", () => {
    const a = new Set(["x"]);
    expect([...toggled(a, "y")]).toEqual(["x", "y"]);
    expect([...toggled(a, "x")]).toEqual([]);
    expect([...a]).toEqual(["x"]);
  });
});

describe("normalizeRange", () => {
  it("orders, rounds to tenths and keeps inside the clip", () => {
    expect(normalizeRange(5.04, 2.26, 8)).toEqual({ fromS: 2.3, toS: 5 });
    expect(normalizeRange(-1, 20, 8)).toEqual({ fromS: 0, toS: 8 });
  });
  it("is null until both ends are marked", () => {
    expect(normalizeRange(null, 2, 8)).toBeNull();
    expect(normalizeRange(1, null, 8)).toBeNull();
    expect(normalizeRange(Number.NaN, 2, 8)).toBeNull();
  });
});

describe("withTimedNote", () => {
  it("adds a trimmed note in time order", () => {
    const first = withTimedNote([], { fromS: 4, toS: 6, text: "  Too fast  " }, 8);
    const next = withTimedNote(first, { fromS: 1, toS: 2, text: "Blurry" }, 8);
    expect(next.map((n) => n.text)).toEqual(["Blurry", "Too fast"]);
  });
  it("ignores an empty note, an unmarked range and a full list", () => {
    expect(withTimedNote([], { fromS: 1, toS: 2, text: "  " }, 8)).toEqual([]);
    expect(withTimedNote([], { fromS: null, toS: 2, text: "x" }, 8)).toEqual([]);
    const full: TimedNote[] = Array.from({ length: MAX_TIMED_NOTES }, (_, i) => ({
      fromS: i,
      toS: i + 1,
      text: "n",
    }));
    expect(withTimedNote(full, { fromS: 0, toS: 1, text: "one more" }, 60)).toHaveLength(
      MAX_TIMED_NOTES,
    );
  });
});

describe("standing and the request", () => {
  it("keeps what the user did not dismiss or drop", () => {
    const left = standing(review, new Set(["i2"]), new Set(["k1"]));
    expect(left.findings.map((f) => f.id)).toEqual(["i1"]);
    expect(left.keeps.map((k) => k.id)).toEqual(["k2"]);
  });

  it("needs a note, a timed note or a finding", () => {
    expect(hasRequest({ note: "  ", timedNotes: [], findings: [] })).toBe(false);
    expect(hasRequest({ note: "Slower", timedNotes: [], findings: [] })).toBe(true);
    expect(
      hasRequest({ note: "", timedNotes: [{ fromS: 0, toS: 1, text: "x" }], findings: [] }),
    ).toBe(true);
    expect(hasRequest({ note: "", timedNotes: [], findings: review.findings })).toBe(true);
  });

  it("sends only ids and the user's words", () => {
    const left = standing(review, new Set(["i2"]), new Set());
    expect(
      changeRequest({
        note: " Closer ",
        timedNotes: [{ fromS: 1, toS: 2, text: "Blurry" }],
        ...left,
      }),
    ).toEqual({
      note: "Closer",
      confirmedIssueIds: ["i1"],
      keepIds: ["k1", "k2"],
      timedNotes: [{ fromS: 1, toS: 2, text: "Blurry" }],
    });
    expect(changeRequest({ note: " ", timedNotes: [], ...left })).not.toHaveProperty("note");
  });
});
