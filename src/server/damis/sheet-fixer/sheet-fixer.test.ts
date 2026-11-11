import { describe, expect, it } from "vitest";
import { runDami } from "../framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { sheetFixer } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { SHEET_ISSUE_CODES, SHEET_ISSUE_LIST, SHEET_ISSUES } from "./issues";
import { buildSheetFixerPrompt } from "./prompt";
import { sheetFixerInputSchema, sheetFixerOutputSchema, sheetIssueCodeSchema } from "./schema";

const input = sheetFixerInputSchema.parse(inputJson);
const output = sheetFixerOutputSchema.parse(outputJson);

describe("sheet issue catalogue", () => {
  it("has 10 to 14 complete entries with unique codes", () => {
    expect(SHEET_ISSUE_LIST.length).toBeGreaterThanOrEqual(10);
    expect(SHEET_ISSUE_LIST.length).toBeLessThanOrEqual(14);
    expect(new Set(SHEET_ISSUE_CODES).size).toBe(SHEET_ISSUE_CODES.length);
    expect(SHEET_ISSUE_LIST.map((i) => i.code)).toEqual([...SHEET_ISSUE_CODES]);
    for (const code of SHEET_ISSUE_CODES) {
      const issue = SHEET_ISSUES[code];
      expect(issue.code).toBe(code);
      expect(issue.label.length).toBeGreaterThan(0);
      expect(issue.hint.length).toBeGreaterThan(0);
      expect(issue.instruction.length).toBeGreaterThan(40);
      expect(sheetIssueCodeSchema.safeParse(code).success).toBe(true);
    }
  });
});

describe("sheet-fixer", () => {
  it("fixture output parses and passes the semantic checks", () => {
    expect(sheetFixer.check(output, input)).toEqual([]);
  });

  it("validates the review and rejects voices", () => {
    expect(sheetFixerInputSchema.safeParse({ ...inputJson, review: {} }).success).toBe(false);
    expect(
      sheetFixerInputSchema.safeParse({ ...inputJson, review: { issueCodes: ["wrong_framing"] } })
        .success,
    ).toBe(true);
    // A look-only code is not a sheet code.
    expect(
      sheetFixerInputSchema.safeParse({ ...inputJson, review: { issueCodes: ["lighting_poor"] } })
        .success,
    ).toBe(false);
    const voice = { ...inputJson, asset: { kind: "voice", name: "Mara (voice)" } };
    expect(sheetFixerInputSchema.safeParse(voice).success).toBe(false);
  });

  it("requires one change-summary entry per request and a changed prompt", () => {
    const missing = { ...output, changeSummary: output.changeSummary.slice(0, 1) };
    expect(sheetFixer.check(missing, input)).toEqual([
      'changeSummary has no entry with request "note"; every request needs one',
    ]);
    expect(sheetFixer.check({ ...output, prompt: input.previousPrompt }, input)).toEqual([
      "the prompt is unchanged; apply the requested changes",
    ]);
  });

  it("builds a stable, cache-ordered prompt that lists the catalogue", () => {
    const a = buildSheetFixerPrompt(input);
    expect(a).toEqual(buildSheetFixerPrompt(sheetFixerInputSchema.parse(inputJson)));
    expect(a.system.map((p) => p.cache)).toEqual([true, true]);
    const system = a.system.map((p) => p.text).join("\n");
    for (const code of SHEET_ISSUE_CODES) expect(system).toContain(`- ${code} (`);
    expect(system).not.toContain(input.previousPrompt);
    const user = a.messages[0]?.content.map((p) => p.text).join("\n") ?? "";
    expect(user).toContain(input.previousPrompt);
    expect(user).toContain('missing_view ("A view is missing")');
  });

  it("runs through the runner", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(sheetFixer, input, {}, testDeps(client).deps);
    expect(result.output.prompt).toContain("back view complete");
  });
});
