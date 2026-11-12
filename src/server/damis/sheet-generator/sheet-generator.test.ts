import { describe, expect, it } from "vitest";
import { partText } from "../framework/define";
import { runDami } from "../framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { sheetGenerator } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { buildSheetGeneratorPrompt } from "./prompt";
import { sheetGeneratorInputSchema, sheetGeneratorOutputSchema } from "./schema";

const input = sheetGeneratorInputSchema.parse(inputJson);

describe("sheet-generator", () => {
  it("fixture output parses", () => {
    expect(sheetGeneratorOutputSchema.safeParse(outputJson).success).toBe(true);
  });

  it("rejects voices and accepts every other kind", () => {
    const base = { style: input.style };
    expect(
      sheetGeneratorInputSchema.safeParse({ ...base, asset: { kind: "voice", name: "Mara" } })
        .success,
    ).toBe(false);
    for (const kind of ["character", "location", "prop", "creature", "costume", "other"]) {
      expect(
        sheetGeneratorInputSchema.safeParse({ ...base, asset: { kind, name: "X" } }).success,
        kind,
      ).toBe(true);
    }
  });

  it("builds a stable, cache-ordered prompt", () => {
    const a = buildSheetGeneratorPrompt(input);
    expect(a).toEqual(buildSheetGeneratorPrompt(sheetGeneratorInputSchema.parse(inputJson)));
    expect(a.system.map((p) => p.cache)).toEqual([true, true]);
    const system = a.system.map((p) => p.text).join("\n");
    expect(system).not.toContain("Mara");
    expect(system).toContain("turnaround");
    const user = a.messages[0]?.content.map(partText).join("\n") ?? "";
    expect(user).toContain("Mara");
    expect(user).toContain("oil-stained");
  });

  it("runs through the runner", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(sheetGenerator, input, {}, testDeps(client).deps);
    expect(result.output.layout.length).toBeGreaterThan(10);
  });
});
