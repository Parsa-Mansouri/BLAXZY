import { describe, expect, it } from "vitest";
import { parseBlockDirection } from "./direction-view";

const shot = (dialogue: Record<string, unknown>[]) => ({
  window: "0-4s",
  shot_number: 1,
  dialogue,
});

describe("parseBlockDirection", () => {
  it("reads heard_as, and a line stored before Director v1.4 as on screen", () => {
    const view = parseBlockDirection({
      shots: [
        shot([
          { speaker_id: "char_1", line: "Hello?", delivery: "", heard_as: "phone_or_device" },
          { speaker_id: "char_2", line: "Yes.", delivery: "" },
        ]),
      ],
    });
    expect(view?.shots[0]?.dialogue.map((d) => d.heard_as)).toEqual([
      "phone_or_device",
      "on_screen",
    ]);
  });

  it("reads voice_rebind_required, false when a revision stored before v1.5 lacks it", () => {
    const flags = { split_required: false, next_block_needs_update: false };
    const old = parseBlockDirection({ shots: [shot([])], revision: { flags } });
    expect(old?.revision?.flags.voice_rebind_required).toBe(false);
    const now = parseBlockDirection({
      shots: [shot([])],
      revision: { flags: { ...flags, voice_rebind_required: true } },
    });
    expect(now?.revision?.flags.voice_rebind_required).toBe(true);
  });
});
