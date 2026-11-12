import { describe, expect, it } from "vitest";
import { enhancer } from "../enhancer/dami";
import {
  enhancerInputSchema,
  enhancerOutputSchema,
  OWNER_ENHANCER_GENRES,
  OWNER_ENHANCER_STYLES,
} from "../enhancer/schema";
import { sampleEnhancer } from "./enhancer";
import { countWords } from "./util";

function run(raw: unknown) {
  const input = enhancerInputSchema.parse(raw);
  const output = enhancerOutputSchema.parse(sampleEnhancer(raw));
  return { input, output };
}

describe("sampleEnhancer", () => {
  it("returns schema-valid output that passes the dami's checks for every genre and style", () => {
    for (const genre of [...OWNER_ENHANCER_GENRES, null]) {
      for (const visualStyle of [...OWNER_ENHANCER_STYLES, null]) {
        const { input, output } = run({ userPrompt: "A man runs.", genre, visualStyle });
        expect(enhancer.check(output, input)).toEqual([]);
        expect(output.applied).toEqual({ genre, visual_style: visualStyle });
        expect(output.look_line === null).toBe(visualStyle === null);
        expect(output.overrides).toEqual([]);
        expect(output.error).toBeNull();
        const words = countWords(output.enhanced_prompt ?? "");
        expect(words).toBeGreaterThanOrEqual(60);
        expect(words).toBeLessThanOrEqual(110);
        if (output.look_line) expect(countWords(output.look_line)).toBeLessThanOrEqual(40);
      }
    }
  });

  it("is deterministic", () => {
    const raw = { userPrompt: "A woman waits at a bus stop.", genre: "Drama", visualStyle: "Noir" };
    expect(sampleEnhancer(raw)).toEqual(sampleEnhancer(raw));
  });

  it("keeps the user's paragraphs in order", () => {
    const scenes = [
      "A chef drops a tray of eggs in the kitchen.",
      "He tries to hide the mess from his boss in the dining room.",
      'The boss says "Is everything fine?" and the chef nods.',
    ];
    const { input, output } = run({
      userPrompt: scenes.join("\n\n"),
      genre: "Comedy",
      visualStyle: "3D Animation",
    });
    expect(enhancer.check(output, input)).toEqual([]);
    const paragraphs = (output.enhanced_prompt ?? "").split("\n\n");
    expect(paragraphs).toHaveLength(3);
    scenes.forEach((scene, i) => expect(paragraphs[i]?.startsWith(scene)).toBe(true));
  });

  it("handles a Persian prompt with no genre or style", () => {
    const userPrompt = "پیرمردی شب در یک کوچه خلوت به سمت خانه‌اش می‌رود";
    const { input, output } = run({ userPrompt, genre: null, visualStyle: null });
    expect(enhancer.check(output, input)).toEqual([]);
    expect(output.enhanced_prompt).toContain(userPrompt);
    expect(output.look_line).toBeNull();
    expect(output.applied).toEqual({ genre: null, visual_style: null });
  });
});
