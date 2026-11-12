import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAUDE_MODELS } from "../framework/models";
import { runDami } from "../framework/runner";
import { createSampleClaudeClient } from "../sample/client";
import { sampleSheetGeneratorCharacter } from "../sample/sheet-generator-character";
import { buildFixRequests, getReviewCatalog } from "../shared/review-catalog";
import { designerInputText } from "../shared/designer";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { checkCharacterSheet, sheetGeneratorCharacter } from "./dami";
import { CHARACTER_SHEET_EDIT_CODES } from "./edit-eligible";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { CHARACTER_SHEET_SYSTEM } from "./prompt";
import {
  characterSheetInputSchema,
  characterSheetOutputSchema,
  designChangeRequests,
} from "./schema";

const lf = (text: string) => text.replace(/\r\n/g, "\n");
const input = characterSheetInputSchema.parse(inputJson);
const output = characterSheetOutputSchema.parse(outputJson);
const withImages = <D extends object>(deps: D) => ({
  ...deps,
  resolveImage: () => Promise.resolve({ mediaType: "image/png" as const, data: "AA==" }),
});
const sampleDeps = () => withImages(testDeps(createSampleClaudeClient({ delayMs: 0 })).deps);

describe("sheet-generator-character", () => {
  it("keeps the whole owner file verbatim as the system prompt", () => {
    const source = lf(
      readFileSync(new URL("./source/sheet_generator_character_v4.md", import.meta.url), "utf8"),
    );
    expect(source.includes(lf(CHARACTER_SHEET_SYSTEM))).toBe(true);
    expect(CHARACTER_SHEET_SYSTEM.length).toBeGreaterThan(source.trim().length - 5);
  });

  it("sends the approved board first and the owner's input fields", () => {
    const prompt = sheetGeneratorCharacter.build(input);
    expect(prompt.system[0]?.text).toBe(CHARACTER_SHEET_SYSTEM);
    const parts = prompt.messages[0]?.content ?? [];
    expect(parts[0]).toEqual({ image: { fileId: "00000000-0000-4000-8000-000000000301" } });
    const json = JSON.parse(designerInputText(prompt)) as Record<string, unknown>;
    expect(json).toMatchObject({
      reference_images: [
        { index: 1, role: "approved" },
        { index: 2, role: "face" },
      ],
      board_prompt: input.boardPrompt,
      render_cell_numbers: true,
      character: { name: "Mara", hair: "A long grey braid" },
    });
    expect(json).not.toHaveProperty("previous_prompt");
  });

  it("fixture output passes the checks; runs on Sonnet", async () => {
    expect(checkCharacterSheet(output, input)).toEqual([]);
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(
      sheetGeneratorCharacter,
      input,
      {},
      withImages(testDeps(client).deps),
    );
    expect(result.output).toEqual(output);
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.sonnet);
  });

  it("flags missing frames, a wrong first image and edit mode without the previous sheet", () => {
    const five = { ...output, detail_cells: output.detail_cells.slice(0, 5) };
    expect(checkCharacterSheet(five, input).join(" ")).toContain("six entries");
    const edit = { ...output, edit_mode: "edit_previous_sheet" as const };
    expect(checkCharacterSheet(edit, input).join(" ")).toContain("previous sheet");
    const noApproved = {
      ...input,
      referenceImages: [{ fileId: "00000000-0000-4000-8000-000000000101", role: "face" as const }],
    };
    expect(checkCharacterSheet(output, noApproved).join(" ")).toContain("approved image");
  });

  it("sample fix: replaces only the named frame, edits the previous sheet, refuses design changes", async () => {
    const catalog = getReviewCatalog("sheet-generator-character");
    const sp01 = catalog.options.find((o) => o.code === "SP01");
    expect(sp01?.editEligible).toBe(true);
    expect(CHARACTER_SHEET_EDIT_CODES).toContain("ST13");
    const requests = buildFixRequests(catalog, [
      {
        code: "SP01",
        value: "the belt and its buckle",
        slot: { slot: 4, subject: output.detail_cells[3]?.subject ?? "" },
      },
    ]);
    const first = sampleSheetGeneratorCharacter(inputJson);
    const fixInput = {
      ...input,
      referenceImages: [
        ...input.referenceImages,
        { fileId: "00000000-0000-4000-8000-000000000302", role: "previous_sheet" as const },
      ],
      previousPrompt: first.image_prompt,
      previousDetailCells: first.detail_cells,
      fixRequests: requests,
    };
    const fixed = await runDami(sheetGeneratorCharacter, fixInput, {}, sampleDeps());
    expect(fixed.output.edit_mode).toBe("edit_previous_sheet");
    expect(fixed.output.detail_cells[3]?.subject).toBe("the belt and its buckle");
    expect(fixed.output.detail_cells[0]).toEqual(first.detail_cells[0]);
    expect(fixed.output.applied_fixes.map((f) => f.code)).toEqual(["SP01"]);

    const design = await runDami(
      sheetGeneratorCharacter,
      {
        ...input,
        previousPrompt: first.image_prompt,
        fixRequests: buildFixRequests(catalog, [{ code: "SP99", customText: "Make her hair red" }]),
      },
      {},
      sampleDeps(),
    );
    expect(design.output.applied_fixes).toEqual([]);
    expect(designChangeRequests(design.output.warnings)).toEqual(["Make her hair red"]);
  });
});
