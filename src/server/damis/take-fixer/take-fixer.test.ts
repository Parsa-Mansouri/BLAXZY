import { describe, expect, it } from "vitest";
import { runDami } from "../framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { takeFixer } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { TAKE_ISSUE_CODES, TAKE_ISSUE_LIST, TAKE_ISSUES } from "./issues";
import { buildTakeFixerPrompt } from "./prompt";
import { takeFixerInputSchema, takeFixerOutputSchema, takeIssueCodeSchema } from "./schema";

const input = takeFixerInputSchema.parse(inputJson);
const output = takeFixerOutputSchema.parse(outputJson);

describe("take issue catalogue", () => {
  it("has about fourteen complete entries with unique codes", () => {
    expect(TAKE_ISSUE_LIST.length).toBeGreaterThanOrEqual(14);
    expect(TAKE_ISSUE_LIST.length).toBeLessThanOrEqual(16);
    expect(new Set(TAKE_ISSUE_CODES).size).toBe(TAKE_ISSUE_CODES.length);
    expect(TAKE_ISSUE_LIST.map((i) => i.code)).toEqual([...TAKE_ISSUE_CODES]);
    for (const code of TAKE_ISSUE_CODES) {
      const issue = TAKE_ISSUES[code];
      expect(issue.code).toBe(code);
      expect(issue.label.length).toBeGreaterThan(0);
      expect(issue.hint.length).toBeGreaterThan(0);
      expect(issue.instruction.length).toBeGreaterThan(40);
      expect(takeIssueCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(takeIssueCodeSchema.safeParse("nope").success).toBe(false);
  });
});

describe("take-fixer", () => {
  it("fixture output parses and passes the semantic checks", () => {
    expect(takeFixer.check(output, input)).toEqual([]);
  });

  it("needs a code or a note, a known stage and known codes", () => {
    expect(takeFixerInputSchema.safeParse({ ...inputJson, review: {} }).success).toBe(false);
    expect(
      takeFixerInputSchema.safeParse({ ...inputJson, review: { issueCodes: ["bogus"] } }).success,
    ).toBe(false);
    expect(takeFixerInputSchema.safeParse({ ...inputJson, stage: "preview" }).success).toBe(false);
    expect(takeFixerInputSchema.safeParse({ ...inputJson, stage: "final" }).success).toBe(true);
  });

  it("requires one change-summary entry per request and a changed prompt", () => {
    const missing = { ...output, changeSummary: output.changeSummary.slice(0, 1) };
    expect(takeFixer.check(missing, input)).toEqual([
      'changeSummary has no entry with request "motion_glitch"; every request needs one',
      'changeSummary has no entry with request "note"; every request needs one',
    ]);
    const same = { ...output, prompt: input.previousPrompt };
    expect(takeFixer.check(same, input)).toEqual([
      "the prompt is unchanged; apply the requested changes",
    ]);
  });

  it("keeps the tokens and their order", () => {
    const dropped = { ...output, prompt: output.prompt.replace(" <<<image_3>>>", "") };
    const droppedIssues = takeFixer.check(dropped, input);
    expect(droppedIssues).toContain(
      "assetRefs entry 3 is never called: <<<image_3>>> is missing from the prompt",
    );
    const renumbered = {
      ...output,
      prompt: output.prompt.replace("<<<image_3>>>", "<<<image_4>>>"),
    };
    expect(takeFixer.check(renumbered, input)).toContain(
      "<<<image_4>>> has no ref: assetRefs has 3 entries",
    );
    const swapped = {
      ...output,
      prompt: output.prompt
        .replace("<<<image_1>>>", "<<<image_x>>>")
        .replace("<<<image_2>>>", "<<<image_1>>>")
        .replace("<<<image_x>>>", "<<<image_2>>>"),
    };
    expect(takeFixer.check(swapped, input)).toEqual([
      "the tokens must stay as they were, in the same order of first appearance: expected <<<image_1>>> <<<image_2>>> <<<image_3>>>, got <<<image_2>>> <<<image_1>>> <<<image_3>>>",
    ]);
  });

  it("builds a stable, cache-ordered prompt that lists the catalogue", () => {
    const a = buildTakeFixerPrompt(input);
    expect(a).toEqual(buildTakeFixerPrompt(takeFixerInputSchema.parse(inputJson)));
    expect(a.system.map((p) => p.cache)).toEqual([true, true]);
    const system = a.system.map((p) => p.text).join("\n");
    for (const code of TAKE_ISSUE_CODES) expect(system).toContain(`- ${code} (`);
    expect(system).not.toContain(input.previousPrompt);
    const user = a.messages[0]?.content.map((p) => p.text).join("\n") ?? "";
    expect(user).toContain(input.previousPrompt);
    expect(user).toContain('face_distorted ("Face distorted")');
    expect(user).toContain("Her braid looks wrong.");
    expect(user).toContain("- Rejected take: draft");
  });

  it("runs through the runner", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(takeFixer, input, {}, testDeps(client).deps);
    expect(result.output.changeSummary.map((c) => c.request)).toEqual([
      "face_distorted",
      "motion_glitch",
      "note",
    ]);
  });
});
