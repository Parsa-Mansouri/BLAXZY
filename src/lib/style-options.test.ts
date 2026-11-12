import { describe, expect, it } from "vitest";
import {
  durationError,
  episodeCount,
  GENRES,
  OTHER_VALUE,
  ownerGenreName,
  ownerStyleName,
  splitChoice,
  VISUAL_STYLES,
} from "./style-options";

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

describe("owner names", () => {
  it("lists the owner's genres and styles, in order", () => {
    expect(GENRES.map((g) => g.label)).toEqual([
      "Drama",
      "Comedy",
      "Horror",
      "Thriller",
      "Action",
      "Science Fiction",
    ]);
    expect(VISUAL_STYLES.map((s) => s.label)).toEqual([
      "Realistic",
      "Noir",
      "Futuristic",
      "Horror Visual Style",
      "3D Animation",
      "Anime",
      "Claymation",
    ]);
  });

  it("maps keys, legacy keys and Other text to the owner's names", () => {
    expect(ownerGenreName("sci-fi")).toBe("Science Fiction");
    expect(ownerGenreName("documentary")).toBe("Drama");
    expect(ownerGenreName("Space western")).toBe("Space western");
    expect(ownerStyleName("horror-visual")).toBe("Horror Visual Style");
    expect(ownerStyleName("cinematic-live-action")).toBe("Realistic");
    expect(ownerStyleName("2d-animation")).toBe("Anime");
    expect(ownerStyleName("Watercolour")).toBe("Watercolour");
  });

  it("shows legacy keys as today's choice", () => {
    expect(splitChoice("cinematic-live-action", VISUAL_STYLES)).toEqual({
      choice: "realistic",
      other: "",
    });
    expect(splitChoice("documentary", GENRES)).toEqual({ choice: "drama", other: "" });
  });
});
