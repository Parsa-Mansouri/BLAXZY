import { describe, expect, it } from "vitest";
import { sampleScriptWriter } from "@/server/damis/sample/script-writer";
import type { Screenplay } from "@/server/damis/script-writer/schema";
import {
  flattenForDetector,
  renderScreenplay,
  sceneNumberAt,
} from "@/server/damis/shared/screenplay";
import { splitScenes } from "./scenes";
import { parseScreenplay } from "./screenplay";

const screenplay: Screenplay = {
  title: "The Last Ferry",
  logline: "Two old lovers meet again.",
  language: "en",
  estimated_duration_seconds: 20,
  scenes: [
    {
      scene_number: 1,
      heading: { int_ext: "INT", location: "Ferry Cabin", time_of_day: "NIGHT" },
      purpose: "p",
      change: "c",
      elements: [
        { type: "action", text: "ANNA (70s), a wool scarf, holds a paper cup." },
        { type: "dialogue", character: "Tomas", text: "Still taking the late boat." },
        {
          type: "dialogue",
          character: "Anna",
          parenthetical: "not looking up",
          text: "Still noticing.",
        },
        { type: "transition", text: "Cut to" },
      ],
      estimated_seconds: 10,
    },
    {
      scene_number: 2,
      heading: { int_ext: "INT/EXT", location: "Ferry Deck", time_of_day: "CONTINUOUS" },
      purpose: "p",
      change: "c",
      elements: [
        { type: "action", text: "Wind." },
        {
          type: "dialogue",
          character: "Narrator",
          extension: "V.O.",
          text: "She never looked back.",
        },
      ],
      estimated_seconds: 10,
    },
  ],
};

describe("rendered screenplay text", () => {
  it("reads back with the Script screen's parser: headings, cues, parentheticals, transitions", () => {
    const rendered = renderScreenplay({ screenplay });
    const types = parseScreenplay(rendered.text).map((l) => `${l.type}:${l.text}`);
    expect(types).toEqual([
      "scene_heading:INT. FERRY CABIN - NIGHT",
      "action:ANNA (70s), a wool scarf, holds a paper cup.",
      "character:TOMAS",
      "dialogue:Still taking the late boat.",
      "character:ANNA",
      "parenthetical:(not looking up)",
      "dialogue:Still noticing.",
      "transition:CUT TO:",
      "scene_heading:INT./EXT. FERRY DECK - CONTINUOUS",
      "action:Wind.",
      "character:NARRATOR (V.O.)",
      "dialogue:She never looked back.",
    ]);
    const scenes = splitScenes(rendered.text);
    expect(scenes.map((s) => s.heading)).toEqual(rendered.scenes.map((s) => s.heading));
    for (const [i, scene] of rendered.scenes.entries()) {
      expect(rendered.text.slice(scene.start, scene.end).startsWith(scene.heading)).toBe(true);
      expect(scenes[i]?.start).toBe(scene.start);
    }
    expect(sceneNumberAt(rendered, rendered.text.indexOf("Wind."))).toBe(2);
  });

  it("puts each episode title before its first scene", () => {
    const rendered = renderScreenplay({
      screenplay,
      episodes: [
        { number: 1, title: "The Crossing", firstScene: 1 },
        { number: 2, title: "Ashore", firstScene: 2 },
      ],
    });
    const lines = parseScreenplay(rendered.text);
    expect(lines.filter((l) => l.type === "episode").map((l) => l.text)).toEqual([
      "EPISODE 1: THE CROSSING",
      "EPISODE 2: ASHORE",
    ]);
    expect(splitScenes(rendered.text)).toHaveLength(2);
  });

  it("reads Persian dialogue cues", () => {
    const persian: Screenplay = {
      ...screenplay,
      scenes: [
        {
          ...screenplay.scenes[0]!,
          heading: { int_ext: "INT", location: "آشپزخانه", time_of_day: "NIGHT" },
          elements: [
            { type: "action", text: "مریم پشت میز نشسته است." },
            { type: "dialogue", character: "مریم", text: "این نامه را چه کسی آورد؟" },
          ],
        },
      ],
    };
    const lines = parseScreenplay(renderScreenplay({ screenplay: persian }).text);
    expect(lines.map((l) => l.type)).toEqual(["scene_heading", "action", "character", "dialogue"]);
  });

  it("flattens scenes for the asset detector", () => {
    const flat = flattenForDetector({ screenplay });
    expect(flat[1]).toMatchObject({
      scene_number: "2",
      heading: "INT./EXT. FERRY DECK - CONTINUOUS",
    });
    expect(flat[0]?.text).toContain("TOMAS\nStill taking the late boat.");
  });

  it("renders sample scripts that parse into their scenes", () => {
    const out = sampleScriptWriter({
      mode: "generate",
      project: {
        genre: "Drama",
        visualStyle: "Realistic",
        format: "film",
        targetDurationSeconds: 240,
        budget: {
          sceneCountRange: { min: 2, max: 6 },
          dialogueWordBudget: 270,
          actionBeatBudget: 44,
          toleranceSeconds: 24,
        },
      },
      story: "An old fisherman named Tomas finds a map in a bottle.",
    });
    const rendered = renderScreenplay({ screenplay: out.screenplay });
    expect(splitScenes(rendered.text)).toHaveLength(out.screenplay.scenes.length);
  });
});
