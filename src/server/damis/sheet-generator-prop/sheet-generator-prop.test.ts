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
import { sampleSheetGeneratorProp } from "../sample/sheet-generator-prop";
import { designerInputText } from "../shared/designer";
import { getReviewCatalog } from "../shared/review-catalog";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { checkPropSheet, sheetGeneratorProp } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { PROP_SHEET_CORE } from "./prompt";
import { propSheetInputSchema, propSheetOutputSchema } from "./schema";

const lf = (text: string) => text.replace(/\r\n/g, "\n");
const input = propSheetInputSchema.parse(inputJson);
const output = propSheetOutputSchema.parse(outputJson);
const withImages = <D extends object>(deps: D) => ({
  ...deps,
  resolveImage: () => Promise.resolve({ mediaType: "image/png" as const, data: "AA==" }),
});
const sampleDeps = () => withImages(testDeps(createSampleClaudeClient({ delayMs: 0 })).deps);

describe("sheet-generator-prop", () => {
  it("keeps the core prompt verbatim from the owner's file", () => {
    const source = lf(
      readFileSync(new URL("./source/sheet_generator_prop_v1.md", import.meta.url), "utf8"),
    );
    expect(source.includes(lf(PROP_SHEET_CORE))).toBe(true);
    expect(PROP_SHEET_CORE.startsWith("You are the Prop Sheet Generator")).toBe(true);
  });

  it("assembles CORE + the four shared modules and the owner's JSON template", () => {
    const prompt = sheetGeneratorProp.build(input);
    const system = prompt.system.map((p) => p.text).join("\n");
    for (const block of [
      PROP_SHEET_CORE,
      PROP_OBJECT_ORIENTATION,
      PROP_VIEW_LIBRARY,
      PROP_STUDIO_STANDARD,
      PROP_OBJECT_TEXT_RULE,
    ]) {
      expect(system).toContain(block);
    }
    const json = JSON.parse(designerInputText(prompt)) as Record<string, unknown>;
    expect(json).toMatchObject({
      approved_images: [{ index: 1, view_id: "hero_34" }],
      user_reference_images: [],
      linked_characters: [{ character_id: "Mara", handedness: "right" }],
      sheet_level_override: null,
      previous_output: null,
    });
  });

  it("fixture output passes the owner's validators; runs on Sonnet", async () => {
    expect(checkPropSheet(output, input)).toEqual([]);
    expect(output.sheet_level).toBe("production");
    expect(output.views.map((v) => v.view_id)).toContain("state_open");
    expect(output.scale_card.text).not.toMatch(/\d/);
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(sheetGeneratorProp, input, {}, withImages(testDeps(client).deps));
    expect(result.output).toEqual(output);
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.sonnet);
  });

  it("flags a level below the minimum, a missing state view and a wrong first reference", () => {
    expect(checkPropSheet({ ...output, sheet_level: "standard" }, input).join(" ")).toContain(
      "production",
    );
    const noState = output.views.filter((v) => v.view_id !== "state_open");
    expect(
      checkPropSheet(
        { ...output, views: noState, generation_order: noState.map((v) => v.view_id) },
        input,
      ).join(" "),
    ).toContain("state_open");
    const badRef = {
      ...output,
      views: output.views.map((v, i) =>
        i === 0
          ? { ...v, reference_order: [{ index: 1, source: "user_reference:1", role: "x" }] }
          : v,
      ),
    };
    expect(checkPropSheet(badRef, input).join(" ")).toContain("approved_hero");
  });

  it("sample: an override below the minimum is raised; AST13 edits; a longer handle is a design change", async () => {
    const raised = sampleSheetGeneratorProp({ ...inputJson, sheetLevelOverride: "simple" });
    expect(raised.sheet_level).toBe("production");
    expect(raised.warnings.length).toBeGreaterThan(0);
    const catalog = getReviewCatalog("sheet-generator-prop");
    expect(catalog.options.find((o) => o.code === "AST13")?.editEligible).toBe(true);
    const first = sampleSheetGeneratorProp(inputJson);
    const edited = await runDami(
      sheetGeneratorProp,
      {
        ...input,
        previousOutput: first,
        fixRequests: [
          {
            code: "AST13",
            instruction: "Remove all labels, captions, numbers, arrows, measurements and borders.",
            viewId: "detail_2",
            editEligible: true,
          },
        ],
      },
      {},
      sampleDeps(),
    );
    const detail = edited.output.views.find((v) => v.view_id === "detail_2");
    expect(detail?.edit_mode).toBe("edit_previous_view");
    expect(detail?.reference_order.map((r) => r.source)).toContain("previous:detail_2");
    expect(edited.output.views.find((v) => v.view_id === "front")).toEqual(
      first.views.find((v) => v.view_id === "front"),
    );
    const design = await runDami(
      sheetGeneratorProp,
      {
        ...input,
        previousOutput: first,
        fixRequests: [
          {
            code: "ASP99",
            instruction: "Apply the user's note without changing the design.",
            note: "make the handle longer",
            viewId: "right",
            editEligible: false,
          },
        ],
      },
      {},
      sampleDeps(),
    );
    expect(design.output.warnings.some((w) => w.startsWith("DESIGN_CHANGE_REQUESTED:"))).toBe(true);
    expect(design.output.applied_fixes).toEqual([]);
  });
});
