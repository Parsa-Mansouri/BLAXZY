import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPromptImage } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { runDami } from "../framework/runner";
import { createSampleClaudeClient } from "../sample/client";
import { sampleCharacterGenerator } from "../sample/character-generator";
import { designerInputText } from "../shared/designer";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { characterGenerator, checkCharacterBoard } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { CHARACTER_GENERATOR_SYSTEM } from "./prompt";
import { characterQuestions } from "./questions";
import { characterGeneratorInputSchema, characterGeneratorOutputSchema } from "./schema";

/** Images are never read in tests. */
const withImages = <D extends object>(deps: D) => ({
  ...deps,
  resolveImage: () => Promise.resolve({ mediaType: "image/png" as const, data: "AA==" }),
});

const lf = (text: string) => text.replace(/\r\n/g, "\n");
const input = characterGeneratorInputSchema.parse(inputJson);
const output = characterGeneratorOutputSchema.parse(outputJson);

describe("character-generator", () => {
  it("keeps the system prompt verbatim from the owner's file", () => {
    const source = lf(
      readFileSync(new URL("./source/character_generator_dami_v5.md", import.meta.url), "utf8"),
    );
    expect(CHARACTER_GENERATOR_SYSTEM.length).toBeGreaterThan(5000);
    expect(source.includes(lf(CHARACTER_GENERATOR_SYSTEM))).toBe(true);
  });

  it("fixture output parses and passes the checks", () => {
    expect(checkCharacterBoard(output, input)).toEqual([]);
    expect(output.aspect_ratio).toBe("16:9");
  });

  it("runs on Sonnet at medium effort with the reference images before the input", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(characterGenerator, input, {}, withImages(testDeps(client).deps));
    expect(result.output).toEqual(output);
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.sonnet);
    expect(characterGenerator.effort).toBe("medium");
    const prompt = characterGenerator.build(input);
    expect(prompt.system).toEqual([{ text: CHARACTER_GENERATOR_SYSTEM, cache: true }]);
    const parts = prompt.messages[0]?.content ?? [];
    expect(parts[0] && isPromptImage(parts[0])).toBe(true);
    const json = JSON.parse(designerInputText(prompt)) as Record<string, unknown>;
    expect(json).toMatchObject({
      project: { style: "Realistic", genre: "Drama" },
      character: { name: "Mara", hair: "A long grey braid" },
      reference_images: [{ index: 1, role: "face" }],
      user_notes: "She should look tired but proud.",
    });
  });

  it("flags a wrong mode, reference order and unapplied fixes", () => {
    expect(checkCharacterBoard({ ...output, mode: "text_only" }, input)).not.toEqual([]);
    expect(checkCharacterBoard({ ...output, reference_order: [] }, input)).not.toEqual([]);
    const fix = characterGeneratorInputSchema.parse({
      ...input,
      previousPrompt: "A board.",
      fixRequests: [{ type: "technical", code: "T01", instruction: "Show the whole face." }],
    });
    expect(checkCharacterBoard(output, fix).join(" ")).toContain("T01");
    expect(checkCharacterBoard(sampleCharacterGenerator(fix), fix)).toEqual([]);
  });

  it("sample mode: text only, references and fixes all pass the checks through the runner", async () => {
    const deps = withImages(testDeps(createSampleClaudeClient({ delayMs: 0 })).deps);
    const textOnly = { ...input, referenceImages: [] };
    const run = await runDami(characterGenerator, textOnly, {}, deps);
    expect(run.output.mode).toBe("text_only");
    expect(run.output.assumptions.length).toBeGreaterThan(0);
    const restyle = await runDami(
      characterGenerator,
      {
        ...input,
        previousPrompt: run.output.image_prompt,
        fixRequests: [
          {
            type: "preference",
            code: "P12",
            instruction: "Re-render in this style: anime.",
            customText: "anime",
          },
        ],
      },
      {},
      deps,
    );
    expect(restyle.output.style_source).toBe("override");
    expect(restyle.output.applied_fixes.map((f) => f.code)).toEqual(["P12"]);
  });

  it("asks the v5 detail fields, with facts from the script chosen in advance", () => {
    const questions = characterQuestions({
      asset: {
        name: "Mara",
        description: null,
        details: {
          facts: [{ field: "age", value: "60s", status: "stated", scene: "1", evidence: "60s" }],
        },
      },
      project: {},
    });
    expect(questions.map((q) => q.id)).toEqual([
      "age",
      "gender",
      "skin_tone",
      "face",
      "hair",
      "body",
      "outfit",
      "accessories",
      "personality",
      "marks",
    ]);
    expect(questions[0]?.prefill).toBe("60s");
  });
});
