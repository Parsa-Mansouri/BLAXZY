import { describe, expect, it } from "vitest";
import { blockIndexAt, sceneIndexAt, splitScenes } from "./scenes";

const SCRIPT = [
  "FADE IN:",
  "",
  "EPISODE 1: THE FIRST SIGN",
  "",
  "EXT. HARBOUR PIER - DUSK",
  "",
  "Mara hurries down the planks.",
  "The boards creak.",
  "",
  "MARA",
  "(quietly)",
  "Wait. Please wait.",
  "",
  "INT. LIGHTHOUSE - NIGHT",
  "",
  "Rain against the glass.",
].join("\n");

describe("splitScenes", () => {
  const scenes = splitScenes(SCRIPT);

  it("cuts at scene headings and keeps the opening text as its own scene", () => {
    expect(scenes.map((s) => s.heading)).toEqual([
      null,
      "EXT. HARBOUR PIER - DUSK",
      "INT. LIGHTHOUSE - NIGHT",
    ]);
  });

  it("moves an episode title into the scene it opens", () => {
    expect(scenes[0]?.blocks.map((b) => b.kind)).toEqual(["transition"]);
    expect(scenes[1]?.blocks.map((b) => b.kind)).toEqual([
      "episode",
      "heading",
      "action",
      "dialogue",
    ]);
  });

  it("joins a paragraph and a cue with its speech into one block each", () => {
    const [, , action, dialogue] = scenes[1]?.blocks ?? [];
    expect(SCRIPT.slice(action?.start, action?.end)).toBe(
      "Mara hurries down the planks.\nThe boards creak.",
    );
    expect(dialogue?.lines.map((l) => l.type)).toEqual(["character", "parenthetical", "dialogue"]);
  });

  it("finds the block and scene holding an offset", () => {
    const at = SCRIPT.indexOf("Please");
    const scene = scenes[sceneIndexAt(scenes, at)];
    expect(scene?.heading).toBe("EXT. HARBOUR PIER - DUSK");
    expect(scene?.blocks[blockIndexAt(scene.blocks, at)]?.kind).toBe("dialogue");
  });

  it("returns nothing for an empty script", () => {
    expect(splitScenes("")).toEqual([]);
  });
});
