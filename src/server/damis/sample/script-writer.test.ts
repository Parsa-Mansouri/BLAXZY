import { describe, expect, it } from "vitest";
import type { ProjectStyle } from "@/server/db/schema";
import { checkOutline, checkScreenplay } from "../script-writer/dami";
import { writerProject } from "../script-writer/project";
import { scriptOutlineInputSchema, scriptWriterInputSchema } from "../script-writer/schema";
import { estimate, runtimeVerdict } from "../shared/duration";
import { sampleScriptOutline, sampleScriptWriter } from "./script-writer";

const style = (seconds: number): ProjectStyle => ({
  visualStyle: "realistic",
  genre: "drama",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: seconds,
});

describe("sample script writer v0.2", () => {
  for (const seconds of [10, 30, 60, 180, 480, 900]) {
    it(`lands inside the runtime tolerance for ${seconds} s`, () => {
      const input = scriptWriterInputSchema.parse({
        mode: "generate",
        project: writerProject(style(seconds), seconds),
        story: "Two old lovers meet again on the last ferry of the night.",
      });
      const out = sampleScriptWriter(input);
      expect(checkScreenplay(out, input)).toEqual([]);
      expect(runtimeVerdict(estimate(out.screenplay).seconds, seconds)).toBe("ok");
    });
  }

  it("revises toward the target and fills the change log", () => {
    const generate = scriptWriterInputSchema.parse({
      mode: "generate",
      project: writerProject(style(180), 180),
      story: "A night train and a stolen photograph.",
    });
    const first = sampleScriptWriter(generate);
    const input = scriptWriterInputSchema.parse({
      mode: "revise",
      project: writerProject(style(90), 90),
      previousScreenplay: first.screenplay,
      feedback: { issueType: "technical", selectedReasons: ["too_long"], customNote: "Cut." },
    });
    const out = sampleScriptWriter(input);
    expect(checkScreenplay(out, input)).toEqual([]);
    expect(estimate(out.screenplay).seconds).toBeLessThan(estimate(first.screenplay).seconds);
  });

  it("writes an outline whose targets add up, then each sequence", () => {
    const outlineInput = scriptOutlineInputSchema.parse({
      project: writerProject(style(1500), 1500),
      story: "A courier named Lena crosses the city.",
    });
    const outline = sampleScriptOutline(outlineInput);
    expect(checkOutline(outline, outlineInput)).toEqual([]);
    const sequence = outline.acts[1]?.sequences[0];
    if (!sequence) throw new Error("no sequence");
    const input = scriptWriterInputSchema.parse({
      mode: "write_segment",
      project: writerProject(style(1500), sequence.target_seconds),
      approvedOutline: { ...outline, approved_additions: [] },
      segmentId: sequence.id,
      continuityLedger: null,
      previousTail: null,
    });
    const out = sampleScriptWriter(input);
    expect(checkScreenplay(out, input)).toEqual([]);
    expect(out.continuity_ledger?.introduced_characters?.length).toBeGreaterThan(0);
  });
});
