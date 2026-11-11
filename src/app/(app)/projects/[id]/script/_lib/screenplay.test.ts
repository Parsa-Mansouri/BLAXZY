import { describe, expect, it } from "vitest";
import { findQuote, parseScreenplay } from "./screenplay";

const SCRIPT = [
  "FADE IN:",
  "",
  "EPISODE 1: THE FIRST SIGN",
  "",
  "EXT. HARBOUR PIER - DUSK",
  "",
  "MARA (60s), broad-shouldered, hurries down the planks.",
  "The boards creak.",
  "",
  "MARA",
  "(quietly)",
  "Wait. Please wait.",
  "Not yet.",
  "",
  "JONAS (V.O.)",
  "You came.",
  "",
  "CUT TO:",
  "",
  "int. lighthouse gallery - night",
  "",
  "BANG!",
  "",
  "FADE OUT.",
].join("\n");

describe("parseScreenplay", () => {
  const lines = parseScreenplay(SCRIPT);
  const types = lines.map((l) => [l.type, l.text]);

  it("types every kind of line", () => {
    expect(types).toEqual([
      ["transition", "FADE IN:"],
      ["episode", "EPISODE 1: THE FIRST SIGN"],
      ["scene_heading", "EXT. HARBOUR PIER - DUSK"],
      ["action", "MARA (60s), broad-shouldered, hurries down the planks."],
      ["action", "The boards creak."],
      ["character", "MARA"],
      ["parenthetical", "(quietly)"],
      ["dialogue", "Wait. Please wait."],
      ["dialogue", "Not yet."],
      ["character", "JONAS (V.O.)"],
      ["dialogue", "You came."],
      ["transition", "CUT TO:"],
      // Lower-case heading reads as action; so does a lone shout with nothing under it.
      ["action", "int. lighthouse gallery - night"],
      ["action", "BANG!"],
      ["transition", "FADE OUT."],
    ]);
  });

  it("keeps exact offsets into the script", () => {
    for (const line of lines) expect(SCRIPT.slice(line.start, line.end)).toBe(line.text);
  });

  it("marks lines that follow a blank line", () => {
    const creak = lines.find((l) => l.text === "The boards creak.");
    const heading = lines.find((l) => l.type === "scene_heading");
    expect(creak?.breakBefore).toBe(false);
    expect(heading?.breakBefore).toBe(true);
    expect(lines[0]?.breakBefore).toBe(true);
  });

  it("handles indentation and Windows line endings", () => {
    const text = "  INT. ATTIC - DAY\r\n\r\n          MILO\r\n     Up here.\r\n";
    const parsed = parseScreenplay(text);
    expect(parsed.map((l) => l.type)).toEqual(["scene_heading", "character", "dialogue"]);
    for (const line of parsed) expect(text.slice(line.start, line.end)).toBe(line.text);
  });

  it("reads anything unknown as action, and empty input as nothing", () => {
    expect(parseScreenplay("")).toEqual([]);
    expect(parseScreenplay("Just some prose about a film.").map((l) => l.type)).toEqual(["action"]);
  });

  it("does not take a caps line without dialogue under it for a character", () => {
    expect(parseScreenplay("\nSILENCE\n\nShe waits.").map((l) => l.type)).toEqual([
      "action",
      "action",
    ]);
  });
});

describe("findQuote", () => {
  it("finds exact and whitespace-shifted quotes", () => {
    expect(findQuote(SCRIPT, "Please wait.")).toEqual({
      start: SCRIPT.indexOf("Please wait."),
      end: SCRIPT.indexOf("Please wait.") + "Please wait.".length,
    });
    const shifted = findQuote(SCRIPT, "Wait. Please   wait. Not yet.");
    expect(shifted && SCRIPT.slice(shifted.start, shifted.end)).toBe(
      "Wait. Please wait.\nNot yet.",
    );
  });

  it("returns null for missing or empty quotes, and escapes patterns", () => {
    expect(findQuote(SCRIPT, "")).toBeNull();
    expect(findQuote(SCRIPT, "Nobody said (this)")).toBeNull();
    expect(findQuote(SCRIPT, "(V.O.)")).not.toBeNull();
  });
});
