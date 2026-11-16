import { describe, expect, it } from "vitest";
import {
  continuityLabel,
  framing,
  parseWindow,
  plain,
  stagingLine,
  windowLabel,
  windowLengths,
} from "./direction-text";

const names = { char_1: "Nora", char_2: "Lina", loc_1: "Kitchen" };
const shot = (over: Record<string, unknown>) => ({
  window: "0-4s",
  shot_number: 1,
  shot: "Medium",
  angle: "eye level",
  camera_height: "",
  camera: "static",
  action: "",
  staging_change: "",
  cut_reason: "",
  dialogue: [],
  ...over,
});

describe("direction text", () => {
  it("replaces the Director's ids with names, leaving unknown ids as they are", () => {
    expect(plain("@char_1 turns to char_2 near @loc_1 and @char_9", names)).toBe(
      "Nora turns to Lina near Kitchen and @char_9",
    );
  });

  it("reads windows and lengths", () => {
    expect(parseWindow("4-9s")).toEqual({ from: 4, to: 9 });
    expect(parseWindow("0–4.5 s")).toEqual({ from: 0, to: 4.5 });
    expect(parseWindow("later")).toBeNull();
    expect(windowLabel("4-9s")).toBe("4–9 s");
    expect(windowLabel("0-4.5s")).toBe("0–4.5 s");
    expect(
      windowLengths([shot({ window: "0-4s" }), shot({ window: "4-15s" }), shot({ window: "?" })]),
    ).toEqual([4, 11, 1]);
  });

  it("frames a shot in one line without empty parts", () => {
    expect(framing(shot({}))).toBe("Medium · eye level · static");
  });

  it("names how a block follows the last one", () => {
    expect(continuityLabel("continuous")).toBe("Carries on from the shot before");
    expect(continuityLabel("weird")).toBeNull();
  });

  it("describes a character's place in plain words", () => {
    const line = stagingLine(
      {
        character_id: "char_1",
        on_screen: true,
        position: "by the stove",
        posture: "standing",
        facing: "away from @char_2",
        gaze: "at the pot",
        screen_side: "frame-left",
        distances: [{ to: "char_2", zone: "social", approx_m: 2.5 }],
      },
      names,
    );
    expect(line.name).toBe("Nora");
    expect(line.detail).toBe(
      "by the stove, standing, frame left, facing away from Lina, looking at the pot, conversation distance to Lina",
    );
    expect(
      stagingLine(
        {
          character_id: "char_2",
          on_screen: false,
          position: "",
          posture: "",
          facing: "",
          gaze: "",
          screen_side: "centre",
          distances: [],
        },
        names,
      ),
    ).toEqual({ name: "Lina", detail: "off screen" });
  });
});
