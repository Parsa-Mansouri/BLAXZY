import { describe, expect, it } from "vitest";
import {
  durationBudget,
  estimate,
  parseDurationText,
  runtimeCorrectionNote,
  runtimeVerdict,
  sceneCountRange,
  toleranceSeconds,
} from "./duration";

describe("the owner's runtime budget", () => {
  it("computes the budget by genre", () => {
    expect(durationBudget(60, "Drama")).toMatchObject({
      targetSeconds: 60,
      tier: "XS",
      sceneCountRange: { min: 1, max: 3 },
      dialogueWordBudget: 68, // 60 × 0.45 × 2.5
      actionBeatBudget: 11, // 60 × 0.55 / 3
      toleranceSeconds: 6,
    });
    expect(durationBudget(600, "Action").dialogueWordBudget).toBe(225);
    expect(durationBudget(600, "Mockumentary").dialogueWordBudget).toBe(525);
    expect(durationBudget(1800, "Drama")).toMatchObject({ tier: "L", sceneCountRange: null });
  });

  it("uses tolerance max(5 s, 10%) and the scene-count guide", () => {
    expect(toleranceSeconds(30)).toBe(5);
    expect(toleranceSeconds(480)).toBe(48);
    expect(sceneCountRange(30)).toEqual({ min: 1, max: 2 });
    expect(sceneCountRange(300)).toEqual({ min: 2, max: 6 });
    expect(sceneCountRange(900)).toEqual({ min: 5, max: 15 });
  });

  it("estimates dialogue words / 2.5 + beats × 3 + scenes", () => {
    const result = estimate({
      scenes: [
        {
          elements: [
            { type: "action", text: "She sets the cup down. She leaves." },
            { type: "dialogue", text: "one two three four five" },
          ],
        },
      ],
    });
    expect(result).toEqual({ seconds: 9, dialogueWords: 5, actionBeats: 2, scenes: 1 });
    expect(runtimeVerdict(70, 60)).toBe("too_long");
    expect(runtimeVerdict(53, 60)).toBe("too_short");
    expect(runtimeVerdict(64, 60)).toBe("ok");
    expect(runtimeCorrectionNote(84, 60)).toBe(
      "Runtime is 84s, target 60s. Cut about 24s. Keep premise and ending.",
    );
  });

  it("reads duration text", () => {
    expect(parseDurationText("30s")).toBe(30);
    expect(parseDurationText("8 min")).toBe(480);
    expect(parseDurationText("1:45")).toBe(105);
    expect(parseDurationText("1 min 30 s")).toBe(90);
    expect(parseDurationText("soon")).toBeNull();
  });
});
