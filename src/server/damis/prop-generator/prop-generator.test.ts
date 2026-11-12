import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAUDE_MODELS } from "../framework/models";
import { runDami } from "../framework/runner";
import {
  PROP_OBJECT_ORIENTATION,
  PROP_OBJECT_TEXT_RULE,
  PROP_STUDIO_STANDARD,
  PROP_VIEW_LIBRARY,
} from "../prop-shared/modules";
import { createSampleClaudeClient } from "../sample/client";
import { samplePropGenerator } from "../sample/prop-generator";
import { designerInputText } from "../shared/designer";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { checkPropSpec, enforceSheetPlan, propGenerator } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { PROP_GENERATOR_CORE, PROP_GENERATOR_SYSTEM } from "./prompt";
import { propQuestions } from "./questions";
import { propGeneratorInputSchema, propGeneratorOutputSchema } from "./schema";

const withImages = <D extends object>(deps: D) => ({
  ...deps,
  resolveImage: () => Promise.resolve({ mediaType: "image/png" as const, data: "AA==" }),
});
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const read = (path: string) => lf(readFileSync(new URL(path, import.meta.url), "utf8"));
const input = propGeneratorInputSchema.parse(inputJson);
const output = propGeneratorOutputSchema.parse(outputJson);
const sampleDeps = () => withImages(testDeps(createSampleClaudeClient({ delayMs: 0 })).deps);

describe("prop-generator", () => {
  it("keeps the core prompt and the four shared modules verbatim from the owner's files", () => {
    expect(read("./source/prop_generator_dami_v1.md").includes(lf(PROP_GENERATOR_CORE))).toBe(true);
    const shared = read("../prop-shared/source/prop_shared_modules_v1.md");
    for (const block of [
      PROP_OBJECT_ORIENTATION,
      PROP_VIEW_LIBRARY,
      PROP_STUDIO_STANDARD,
      PROP_OBJECT_TEXT_RULE,
    ]) {
      expect(block.length).toBeGreaterThan(200);
      expect(shared.includes(lf(block))).toBe(true);
    }
    expect(PROP_GENERATOR_SYSTEM.startsWith(PROP_GENERATOR_CORE)).toBe(true);
  });

  it("fixture output passes the checks; runs on Sonnet with the owner's input template", async () => {
    expect(checkPropSpec(output, input)).toEqual([]);
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(propGenerator, input, {}, testDeps(client).deps);
    expect(result.output.sheet_plan.level).toBe("production");
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.sonnet);
    const json = JSON.parse(designerInputText(propGenerator.build(input))) as Record<
      string,
      unknown
    >;
    expect(json).toMatchObject({
      asset: { asset_id: "brass locket", category_hint: "hand_prop" },
      source_mode: "prompt_only",
      linked_characters: [{ character_id: "Mara", handedness: "right" }],
    });
  });

  it("raises the sheet level for hero or multi-state props and plans every state view", () => {
    const low = {
      ...output,
      sheet_plan: { level: "simple" as const, level_reason: "", views: [] },
    };
    const raised = enforceSheetPlan(low);
    expect(raised.sheet_plan.level).toBe("production");
    expect(raised.sheet_plan.views.map((v) => v.view_id)).toContain("state_open");
  });

  it("checks blocking questions, defaults and reference sources", () => {
    const blocked = {
      ...output,
      hero_view: null,
      clarifying_questions: [
        {
          id: "q",
          field: "what",
          question: "What?",
          options: ["A", "B"],
          default: "C",
          blocking: true,
        },
      ],
    };
    expect(checkPropSpec(blocked, input).join(" ")).toContain("default");
    expect(checkPropSpec({ ...output, hero_view: null }, input)).not.toEqual([]);
    const badRef = {
      ...output,
      hero_view: output.hero_view && {
        ...output.hero_view,
        reference_order: [{ index: 1, source: "user_reference:3", role: "identity" }],
      },
    };
    expect(checkPropSpec(badRef, input).join(" ")).toContain("user_reference:3");
  });

  it("sample mode: an unknown object asks one blocking question; the answer designs it", async () => {
    const deps = sampleDeps();
    const unknown = {
      asset: { name: "the device" },
      project: input.project,
    };
    const asked = await runDami(propGenerator, unknown, {}, deps);
    expect(asked.output.hero_view).toBeNull();
    expect(asked.output.clarifying_questions.filter((q) => q.blocking)).toHaveLength(1);
    const answered = await runDami(
      propGenerator,
      { ...unknown, clarifyAnswers: { identity: "A device" } },
      {},
      deps,
    );
    expect(answered.output.hero_view?.image_prompt).toContain("A device");
    const castle = await runDami(
      propGenerator,
      { ...unknown, asset: { name: "the whole castle" } },
      {},
      deps,
    );
    expect(castle.output.hero_view).toBeNull();
    expect(castle.output.warnings[0]).toMatch(/^NOT_A_PROP:/);
  });

  it("sample mode: an anchored prop comes from the location Hero; a fix reports identity changes", async () => {
    const deps = sampleDeps();
    const anchored = await runDami(
      propGenerator,
      {
        ...input,
        referenceImages: [{ fileId: "00000000-0000-4000-8000-000000000301", role: "identity" }],
        linkedLocations: [
          {
            name: "Ferry Cabin",
            summary: "A cramped cabin.",
            anchor: "Locket shelf (N wall)",
            heroFileId: "00000000-0000-4000-8000-000000000302",
          },
        ],
      },
      {},
      deps,
    );
    expect(anchored.output.hero_view?.hero_source).toBe("from_location");
    expect(anchored.output.hero_view?.reference_order.map((r) => r.source)).toEqual([
      "user_reference:1",
      "location_hero:Ferry Cabin",
    ]);
    const fixed = await runDami(
      propGenerator,
      {
        ...input,
        previousOutput: samplePropGenerator(inputJson),
        fixRequests: [
          {
            type: "preference",
            code: "AP02",
            instruction: "Change the colours.",
            customText: "dark green",
          },
        ],
      },
      {},
      deps,
    );
    expect(fixed.output.changes_identity).toBe(true);
    expect(fixed.output.applied_fixes.map((f) => f.code)).toEqual(["AP02"]);
  });

  it("asks the owner's five questions plus Advanced, with the script's suggestions", () => {
    const questions = propQuestions({
      asset: {
        name: "brass locket",
        description: "A locket.",
        details: { categoryHint: "hand_prop", states: [] },
      },
      project: {},
    });
    const main = questions.filter((q) => !q.advanced).map((q) => q.id);
    expect(main).toEqual(["importance", "usage", "scale", "must_keep"]);
    expect(questions.filter((q) => q.advanced)).toHaveLength(10);
    expect(questions.find((q) => q.id === "usage")?.prefill).toBe("carried");
    const unknown = propQuestions({
      asset: { name: "x", description: null, details: null },
      project: {},
    });
    expect(unknown[0]?.id).toBe("what_is_it");
  });
});
