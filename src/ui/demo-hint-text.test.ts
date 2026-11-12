import { describe, expect, it } from "vitest";
import {
  DEMO_PROMPT_KINDS,
  caretBlinks,
  clipText,
  samplePrompt,
  typingPlan,
} from "./demo-hint-text";

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}

describe("samplePrompt", () => {
  it("uses the name and the description", () => {
    const prompt = samplePrompt(
      "character",
      "Ines",
      "the keeper's daughter, thirty, in a patched oilskin coat",
    );
    expect(prompt).toBe(
      "Ines. The keeper's daughter, thirty, in a patched oilskin coat. Full figure, standing alone, even light on a plain background.",
    );
  });

  it("has a template for every kind, with and without a description", () => {
    const seen = new Set<string>();
    for (const kind of DEMO_PROMPT_KINDS) {
      const bare = samplePrompt(kind, "Marlow", null);
      const full = samplePrompt(kind, "Marlow", "Worn and salt-stained.");
      expect(bare.startsWith("Marlow. ")).toBe(true);
      expect(full).toContain("Worn and salt-stained.");
      for (const prompt of [bare, full]) {
        expect(sentences(prompt).length).toBe(3);
        expect(prompt).not.toMatch(/\s{2,}|\.\.|undefined|null/);
        expect(prompt.length).toBeLessThanOrEqual(240);
      }
      seen.add(bare);
    }
    expect(seen.size).toBe(DEMO_PROMPT_KINDS.length);
  });

  it("falls back to the generic template for an unknown kind", () => {
    expect(samplePrompt("vehicle", "The Skiff", null)).toBe(samplePrompt("other", "The Skiff", ""));
  });

  it("names the kind when there is no name", () => {
    expect(samplePrompt("location", "  ", null)).toMatch(/^The location\. /);
    expect(samplePrompt("voice", null, undefined)).toMatch(/^The voice\. /);
  });

  it("keeps only the first sentence of a long description and clips it", () => {
    const prompt = samplePrompt(
      "prop",
      "Lantern",
      "A brass storm lantern with a cracked glass chimney and a soot-black wick, carried by every keeper since the light was first lit on the rock.  It hangs by the door!",
    );
    const [, about] = sentences(prompt);
    expect(about).toBeDefined();
    expect(about?.length).toBeLessThanOrEqual(98);
    expect(about?.endsWith(".")).toBe(true);
    expect(prompt).not.toContain("hangs by the door");
  });

  it("tidies stray punctuation and whitespace", () => {
    expect(samplePrompt("costume", "Oilskin coat.", "  patched\n at the elbows.. ")).toBe(
      "Oilskin coat. Patched at the elbows. Shown whole, evenly lit, on a plain background.",
    );
  });
});

describe("clipText", () => {
  it("leaves short text alone and cuts long text at a word", () => {
    expect(clipText("  a  short   line ", 40)).toBe("a short line");
    expect(clipText("one two three four five", 14)).toBe("one two three");
    expect(clipText("one two, three", 9)).toBe("one two");
  });
});

describe("typingPlan", () => {
  it("is empty without lines", () => {
    expect(typingPlan([])).toEqual({ passes: [], totalMs: 0 });
    expect(typingPlan(["", "   "])).toEqual({ passes: [], totalMs: 0 });
  });

  it("types a single line once and leaves it", () => {
    const plan = typingPlan(["A brass lantern."]);
    expect(plan.passes).toHaveLength(1);
    const pass = plan.passes[0];
    expect(pass?.stays).toBe(true);
    expect(pass?.chars.every((c) => c.outMs === null)).toBe(true);
    expect(plan.totalMs).toBe(pass?.typedMs);
  });

  it("types, erases and ends on the first line again", () => {
    const plan = typingPlan(["First line.", "Second, longer line."]);
    expect(plan.passes.map((p) => p.text)).toEqual([
      "First line.",
      "Second, longer line.",
      "First line.",
    ]);
    expect(plan.passes.map((p) => p.stays)).toEqual([false, false, true]);
  });

  it("orders every character in time and keeps passes apart", () => {
    const plan = typingPlan(["First line.", "Second, longer line."], { startMs: 200 });
    let previousEnd = 0;
    for (const pass of plan.passes) {
      expect(pass.chars[0]?.inMs).toBeGreaterThanOrEqual(Math.max(200, previousEnd));
      pass.chars.forEach((char, i) => {
        const next = pass.chars[i + 1];
        if (next) {
          expect(next.inMs).toBeGreaterThan(char.inMs);
          expect(char.caretMs).toBe(next.inMs - char.inMs);
          // Erased from the end backwards.
          if (char.outMs !== null && next.outMs !== null) {
            expect(char.outMs).toBeGreaterThan(next.outMs);
          }
        }
        if (char.outMs !== null) expect(char.outMs).toBeGreaterThan(pass.typedMs);
      });
      expect(pass.endMs).toBeGreaterThanOrEqual(pass.typedMs);
      previousEnd = pass.endMs;
    }
    expect(plan.totalMs).toBe(previousEnd);
  });

  it("pauses after punctuation", () => {
    const pass = typingPlan(["ab. cd"], { stepMs: 40 }).passes[0];
    const gaps = pass?.chars.map((c) => c.caretMs) ?? [];
    // The gap after the full stop is far longer than any letter's.
    expect(gaps[2]).toBeGreaterThan(40 * 8);
    expect(gaps[0]).toBeLessThan(40 * 2);
  });

  it("clips long lines and is deterministic", () => {
    const long = "word ".repeat(80);
    const plan = typingPlan([long], { maxChars: 60 });
    expect(plan.passes[0]?.chars.length).toBeLessThanOrEqual(60);
    expect(typingPlan([long], { maxChars: 60 })).toEqual(plan);
  });
});

describe("caretBlinks", () => {
  it("is at least one", () => {
    expect(caretBlinks(0)).toBe(1);
    expect(caretBlinks(1400)).toBe(2);
  });
});
