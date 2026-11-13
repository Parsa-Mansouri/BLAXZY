import { describe, expect, it } from "vitest";
import { toClientOption, toClientOptions } from "./review-option";

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

const server = {
  code: "P01",
  kind: "preference" as const,
  group: "look",
  label: "Older",
  needsText: false,
  proOnly: false,
  targetCount: 1,
  instruction: "SECRET prompt",
  instructionTemplate: "Make them {value}.",
  instructionTemplateAuto: "SECRET auto",
  callsClaude: true,
  editEligible: true,
  note: "internal note",
  followup: {
    type: "chips_or_text",
    allowCustom: true,
    options: [{ label: "Older", value: "older", instruction: "SECRET chip" }],
    steps: [
      {
        type: "chips",
        allowCustom: false,
        options: [{ label: "A", value: "a", instructionTemplate: "SECRET" }],
        display: "{slot}",
      },
    ],
  },
};

describe("toClientOption", () => {
  it("never carries a key starting with instruction, at any depth", () => {
    const out = toClientOption(server);
    expect(keysDeep(out).filter((k) => k.startsWith("instruction"))).toEqual([]);
    expect(JSON.stringify(out)).not.toContain("SECRET");
  });

  it("drops other server-only fields", () => {
    const out = toClientOption(server) as Record<string, unknown>;
    expect(out.callsClaude).toBeUndefined();
    expect(out.editEligible).toBeUndefined();
    expect(out.note).toBeUndefined();
  });

  it("computes takesValue from the template", () => {
    expect(toClientOption(server).takesValue).toBe(true);
    expect(toClientOption({ ...server, instructionTemplate: "No slot." }).takesValue).toBe(false);
    expect(toClientOption({ ...server, instructionTemplate: undefined }).takesValue).toBe(false);
  });

  it("keeps the fields the screens read", () => {
    const out = toClientOption(server);
    expect(out).toMatchObject({ code: "P01", kind: "preference", group: "look", targetCount: 1 });
    expect(out.followup?.steps?.[0]?.display).toBe("{slot}");
  });

  it("omits absent optional fields", () => {
    const out = toClientOption({ ...server, group: undefined, followup: undefined });
    expect("group" in out).toBe(false);
    expect("followup" in out).toBe(false);
  });

  it("projects a list", () => {
    expect(toClientOptions([server, server])).toHaveLength(2);
  });
});
