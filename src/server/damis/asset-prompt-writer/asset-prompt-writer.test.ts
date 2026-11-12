import { describe, expect, it } from "vitest";
import { ASSET_KINDS } from "@/server/db/schema";
import { runDami } from "../framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { assetPromptWriter } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { buildAssetPromptWriterPrompt, renderGuidedAnswers } from "./prompt";
import { ASSET_QUESTIONS } from "./questions";
import { assetPromptWriterInputSchema, assetPromptWriterOutputSchema } from "./schema";

const input = assetPromptWriterInputSchema.parse(inputJson);

describe("guided questions", () => {
  it("has a list for every asset kind, voices empty", () => {
    expect(Object.keys(ASSET_QUESTIONS).sort()).toEqual([...ASSET_KINDS].sort());
    expect(ASSET_QUESTIONS.voice).toEqual([]);
    for (const kind of ASSET_KINDS) {
      if (kind === "voice") continue;
      const count = ASSET_QUESTIONS[kind].length;
      expect(count, kind).toBeGreaterThanOrEqual(5);
      expect(count, kind).toBeLessThanOrEqual(8);
    }
  });

  it("has unique ids per kind and options on every choice question", () => {
    for (const kind of ASSET_KINDS) {
      const questions = ASSET_QUESTIONS[kind];
      const ids = questions.map((q) => q.id);
      expect(new Set(ids).size, kind).toBe(ids.length);
      for (const q of questions) {
        expect(q.label.length).toBeGreaterThan(3);
        expect(q.hint.length).toBeGreaterThan(3);
        // Its own short field name, a word or two that fits the casting sheet's label column.
        expect(q.short, `${kind}.${q.id}`).not.toContain("_");
        expect(q.short.length, `${kind}.${q.id}`).toBeLessThanOrEqual(12);
        if (q.kind === "choice") {
          expect(q.options?.length ?? 0, `${kind}.${q.id}`).toBeGreaterThanOrEqual(2);
          const values = (q.options ?? []).map((o) => o.value);
          expect(new Set(values).size).toBe(values.length);
        } else {
          expect(q.options).toBeUndefined();
        }
      }
    }
  });
});

describe("asset-prompt-writer", () => {
  it("fixture output parses", () => {
    expect(assetPromptWriterOutputSchema.safeParse(outputJson).success).toBe(true);
    expect(assetPromptWriter.check(assetPromptWriterOutputSchema.parse(outputJson), input)).toEqual(
      [],
    );
  });

  it("requires a prompt or an answer", () => {
    const base = { style: input.style, asset: input.asset };
    expect(assetPromptWriterInputSchema.safeParse(base).success).toBe(false);
    expect(assetPromptWriterInputSchema.safeParse({ ...base, userPrompt: "  " }).success).toBe(
      false,
    );
    expect(
      assetPromptWriterInputSchema.safeParse({ ...base, guidedAnswers: { hair: "" } }).success,
    ).toBe(false);
    expect(assetPromptWriterInputSchema.safeParse({ ...base, userPrompt: "x" }).success).toBe(true);
    expect(
      assetPromptWriterInputSchema.safeParse({ ...base, guidedAnswers: { hair: "red" } }).success,
    ).toBe(true);
  });

  it("rejects voices", () => {
    const voice = { ...input, asset: { kind: "voice", name: "Mara (voice)", description: "" } };
    expect(assetPromptWriterInputSchema.safeParse(voice).success).toBe(false);
  });

  it("builds a stable, cache-ordered prompt", () => {
    const a = buildAssetPromptWriterPrompt(input);
    const b = buildAssetPromptWriterPrompt(assetPromptWriterInputSchema.parse(inputJson));
    expect(a).toEqual(b);
    expect(a.system.map((p) => p.cache)).toEqual([true, true]);
    const system = a.system.map((p) => p.text).join("\n");
    expect(system).not.toContain(input.asset.name);
    expect(system).toContain("Photoreal studio reference photograph");
    const user = a.messages[0]?.content.map((p) => p.text).join("\n") ?? "";
    expect(user).toContain("Mara");
    expect(user).toContain("grey eyes");
    expect(user).toContain("How old are they? Older (60s-70s)");
  });

  it("renders answers in question order, labelling choices and keeping unknown ids", () => {
    const lines = renderGuidedAnswers("character", {
      zzz: "last",
      hair: "short white",
      age: "Teenager",
      build: "",
    });
    expect(lines).toEqual([
      "- How old are they? Teenager",
      "- What is their hair like? short white",
      "- zzz: last",
    ]);
    expect(renderGuidedAnswers("character", undefined)).toEqual([]);
  });

  it("runs through the runner", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(assetPromptWriter, input, {}, testDeps(client).deps);
    expect(result.output.prompt).toContain("grey eyes");
    expect(client.requests).toHaveLength(1);
  });
});
