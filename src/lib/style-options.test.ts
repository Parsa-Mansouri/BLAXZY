import { describe, expect, it } from "vitest";
import { durationError, episodeCount, GENRES, OTHER_VALUE, splitChoice } from "./style-options";

describe("durationError", () => {
  it("accepts a normal duration", () => {
    expect(durationError("total", 180, null)).toBeNull();
  });
  it("asks for a missing value and rejects out-of-range ones", () => {
    expect(durationError("total", null, null)).toMatch(/Enter the total/);
    expect(durationError("total", 4, null)).toMatch(/at least 5/);
    expect(durationError("total", 4 * 3600 + 1, null)).toMatch(/4 hours/);
  });
  it("rejects an episode longer than the series or making over 100 episodes", () => {
    expect(durationError("episode", 600, 300)).toMatch(/longer than the whole series/);
    expect(durationError("episode", 5, 600)).toMatch(/more than 100 episodes/);
    expect(durationError("episode", 60, 360)).toBeNull();
  });
});

describe("episodeCount", () => {
  it("rounds up", () => {
    expect(episodeCount(360, 60)).toBe(6);
    expect(episodeCount(370, 60)).toBe(7);
  });
});

describe("splitChoice", () => {
  it("maps stored values back to a choice or Other", () => {
    expect(splitChoice("drama", GENRES)).toEqual({ choice: "drama", other: "" });
    expect(splitChoice("western", GENRES)).toEqual({ choice: OTHER_VALUE, other: "western" });
    expect(splitChoice(undefined, GENRES)).toEqual({ choice: null, other: "" });
  });
});
