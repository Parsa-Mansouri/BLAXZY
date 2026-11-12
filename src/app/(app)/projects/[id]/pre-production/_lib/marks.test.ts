import { describe, expect, it } from "vitest";
import { firstBlankMark, foldMarks, groupIssues, nudgeMark, regionWords, type Mark } from "./marks";

const mark = (x: number, y: number, text: string, id = `${x}-${y}`): Mark => ({ id, x, y, text });

describe("regionWords", () => {
  it("names the nine cells of a 3×3 grid", () => {
    expect(regionWords(0.1, 0.1)).toBe("upper left");
    expect(regionWords(0.5, 0.1)).toBe("upper centre");
    expect(regionWords(0.9, 0.2)).toBe("upper right");
    expect(regionWords(0.1, 0.5)).toBe("middle left");
    expect(regionWords(0.5, 0.5)).toBe("centre");
    expect(regionWords(0.8, 0.5)).toBe("middle right");
    expect(regionWords(0.2, 0.9)).toBe("lower left");
    expect(regionWords(0.5, 0.7)).toBe("lower centre");
    expect(regionWords(1, 1)).toBe("lower right");
  });

  it("clamps points off the picture to its edges", () => {
    expect(regionWords(-3, -1)).toBe("upper left");
    expect(regionWords(4, 2)).toBe("lower right");
    expect(regionWords(Number.NaN, 0.5)).toBe("centre");
  });
});

describe("nudgeMark", () => {
  it("moves within the picture", () => {
    expect(nudgeMark(mark(0.5, 0.5, ""), 0.1, -0.1)).toMatchObject({ x: 0.6, y: 0.4 });
    expect(nudgeMark(mark(0.99, 0.01, ""), 0.1, -0.1)).toMatchObject({ x: 1, y: 0 });
  });
});

describe("foldMarks", () => {
  it("returns the note alone without marks", () => {
    expect(foldMarks("  Warmer light.  ", [], "image")).toBe("Warmer light.");
  });

  it("appends numbered marks with their region as plain sentences", () => {
    const folded = foldMarks(
      "Warmer light overall.",
      [mark(0.1, 0.1, "the lamp is too bright"), mark(0.5, 0.5, "No cup on the table!")],
      "image",
    );
    expect(folded).toBe(
      [
        "Warmer light overall.",
        "",
        "Marked on the image:",
        "1 (upper left): the lamp is too bright.",
        "2 (centre): No cup on the table!",
      ].join("\n"),
    );
  });

  it("works with marks only, flattens line breaks and skips blank marks", () => {
    expect(foldMarks("", [mark(0.9, 0.9, "  "), mark(0.9, 0.9, "too\n  dark")], "sheet")).toBe(
      "Marked on the sheet:\n1 (lower right): too dark.",
    );
  });
});

describe("firstBlankMark", () => {
  it("finds the first mark without a comment", () => {
    expect(firstBlankMark([])).toBeNull();
    expect(firstBlankMark([mark(0, 0, "a"), mark(0, 0, " "), mark(0, 0, "")])).toBe(2);
  });
});

describe("groupIssues", () => {
  it("groups by subject, look and frame in that order and drops empty groups", () => {
    const issues = [
      { code: "lighting_poor" },
      { code: "wrong_framing" },
      { code: "wrong_details" },
      { code: "style_mismatch" },
      { code: "something_new" },
    ];
    expect(groupIssues(issues).map((g) => [g.label, g.issues.map((i) => i.code)])).toEqual([
      ["Subject", ["wrong_details"]],
      ["Look", ["lighting_poor", "style_mismatch", "something_new"]],
      ["Frame", ["wrong_framing"]],
    ]);
    expect(groupIssues([{ code: "wrong_framing" }]).map((g) => g.key)).toEqual(["frame"]);
  });
});
