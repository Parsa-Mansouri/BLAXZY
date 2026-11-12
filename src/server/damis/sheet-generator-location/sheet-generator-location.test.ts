import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAUDE_MODELS } from "../framework/models";
import { runDami } from "../framework/runner";
import { LOCATION_GENRE_LENSES, LOCATION_ORIENTATION_SYSTEM } from "../location-shared/modules";
import { createSampleClaudeClient } from "../sample/client";
import { sampleSheetGeneratorLocation } from "../sample/sheet-generator-location";
import { designerInputText } from "../shared/designer";
import { getReviewCatalog } from "../shared/review-catalog";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { checkLocationSheet, sheetGeneratorLocation } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { LOCATION_SHEET_CORE } from "./prompt";
import { locationSheetInputSchema, locationSheetOutputSchema } from "./schema";

const lf = (text: string) => text.replace(/\r\n/g, "\n");
const input = locationSheetInputSchema.parse(inputJson);
const output = locationSheetOutputSchema.parse(outputJson);
const withImages = <D extends object>(deps: D) => ({
  ...deps,
  resolveImage: () => Promise.resolve({ mediaType: "image/png" as const, data: "AA==" }),
});
const sampleDeps = () => withImages(testDeps(createSampleClaudeClient({ delayMs: 0 })).deps);

describe("sheet-generator-location", () => {
  it("keeps the core prompt verbatim from the owner's file", () => {
    const source = lf(
      readFileSync(new URL("./source/sheet_generator_location_v1.md", import.meta.url), "utf8"),
    );
    expect(source.includes(lf(LOCATION_SHEET_CORE))).toBe(true);
    expect(LOCATION_SHEET_CORE.startsWith("# ROLE")).toBe(true);
  });

  it("assembles CORE + ORIENTATION + lenses and the owner's <input>", () => {
    const prompt = sheetGeneratorLocation.build(input);
    const system = prompt.system.map((p) => p.text).join("\n");
    expect(system).toContain(LOCATION_SHEET_CORE);
    expect(system).toContain(LOCATION_ORIENTATION_SYSTEM);
    expect(system).toContain(LOCATION_GENRE_LENSES.Thriller);
    const text = designerInputText(prompt);
    const json = JSON.parse(text.slice("<input>\n".length, -"\n</input>".length)) as Record<
      string,
      unknown
    >;
    expect(json).toMatchObject({
      mode: "lock",
      approved_images: [{ index: 1, view_id: "hero_wide" }],
      only_views: null,
      fix_requests: [],
    });
    expect(Object.keys(json.locked_spec as object).sort()).toEqual(
      ["coverage_plan", "dna", "layout", "location_summary", "spec_fields", "style_used"].sort(),
    );
  });

  it("fixture output passes the owner's tests; runs on Sonnet", async () => {
    expect(checkLocationSheet(output, input)).toEqual([]);
    expect(output.views.map((v) => v.view_id)).not.toContain("hero_wide");
    const reverse = output.views.find((v) => v.view_id === "reverse_wide");
    expect(reverse?.reference_order[0]?.source_view_id).toBe("hero_wide");
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(
      sheetGeneratorLocation,
      input,
      {},
      withImages(testDeps(client).deps),
    );
    expect(result.output).toEqual(output);
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.sonnet);
  });

  it("flags a bad order, a missing view and edit mode without eligibility", () => {
    const reversed = { ...output, generation_order: [...output.generation_order].reverse() };
    expect(checkLocationSheet(reversed, input).join(" ")).toContain("generation_order");
    const missing = {
      ...output,
      views: output.views.slice(1),
      generation_order: output.generation_order.slice(1),
    };
    expect(checkLocationSheet(missing, input).join(" ")).toContain("reverse_wide");
    const edit = {
      ...output,
      views: output.views.map((v, i) =>
        i === 0 ? { ...v, edit_mode: "edit_previous_view" as const } : v,
      ),
    };
    expect(checkLocationSheet(edit, input).join(" ")).toContain("edit_previous_view");
  });

  it("concept mode returns the four panels and no views", async () => {
    const concept = await runDami(
      sheetGeneratorLocation,
      { ...input, mode: "concept" },
      {},
      sampleDeps(),
    );
    expect(concept.output.views).toEqual([]);
    expect(concept.output.concept_sheet?.panel_plan).toHaveLength(4);
  });

  it("sample fix: only_views, LST05 edits the previous view, a moved door is a design change", async () => {
    const catalog = getReviewCatalog("sheet-generator-location");
    expect(catalog.options.find((o) => o.code === "LST05")?.editEligible).toBe(true);
    const first = sampleSheetGeneratorLocation(inputJson);
    const edit = await runDami(
      sheetGeneratorLocation,
      {
        ...input,
        approvedImages: [
          ...input.approvedImages,
          { fileId: "00000000-0000-4000-8000-000000000402", viewId: "reverse_wide" },
        ],
        onlyViews: ["corner_a"],
        previousOutput: first,
        fixRequests: [
          {
            code: "LST05",
            instruction: "Use the Hero's time of day, light direction logic, weather and palette.",
            viewId: "corner_a",
            editEligible: true,
          },
        ],
      },
      {},
      sampleDeps(),
    );
    expect(edit.output.views.map((v) => v.view_id)).toEqual(["corner_a"]);
    expect(edit.output.views[0]?.edit_mode).toBe("edit_previous_view");
    expect(edit.output.views[0]?.reference_order.map((r) => r.source_view_id)).toContain(
      "previous:corner_a",
    );
    expect(edit.output.applied_fixes).toEqual(["LST05"]);
    const design = await runDami(
      sheetGeneratorLocation,
      {
        ...input,
        onlyViews: ["reverse_wide"],
        previousOutput: first,
        fixRequests: [
          {
            code: "LSP99",
            instruction: "Apply the user's note without changing DNA or layout.",
            note: "move the door to the other wall",
            viewId: "reverse_wide",
            editEligible: false,
          },
        ],
      },
      {},
      sampleDeps(),
    );
    expect(design.output.warnings[0]).toMatch(/^DESIGN_CHANGE_REQUESTED:/);
    expect(design.output.views[0]?.image_prompt).toBe(first.views[0]?.image_prompt);
  });
});
