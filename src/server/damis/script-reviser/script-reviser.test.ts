import { describe, expect, it } from "vitest";
import { partText } from "../framework/define";
import { runDami } from "../framework/runner";
import { splitLines } from "../shared/script-lines";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { scriptReviser } from "./dami";
import { applyLineEdits, validateLineEdits } from "./edits";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { SCRIPT_ISSUE_CODES, SCRIPT_ISSUE_LIST, SCRIPT_ISSUES } from "./issues";
import { scriptReviserInputSchema, scriptReviserModelOutputSchema } from "./schema";

const input = scriptReviserInputSchema.parse(inputJson);
const output = scriptReviserModelOutputSchema.parse(outputJson);

describe("script issue catalogue", () => {
  it("has one complete entry per code", () => {
    expect(SCRIPT_ISSUE_LIST.map((i) => i.code)).toEqual([...SCRIPT_ISSUE_CODES]);
    for (const code of SCRIPT_ISSUE_CODES) {
      expect(SCRIPT_ISSUES[code].code).toBe(code);
      expect(SCRIPT_ISSUES[code].label.length).toBeGreaterThan(0);
      expect(SCRIPT_ISSUES[code].instruction.length).toBeGreaterThan(20);
    }
  });
});

describe("script-reviser", () => {
  it("fixture output parses and passes the semantic checks", () => {
    expect(scriptReviser.check(output, input)).toEqual([]);
  });

  it("applies the edits and keeps every untouched line", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(scriptReviser, input, {}, testDeps(client).deps);
    const before = splitLines(input.content);
    const after = splitLines(result.output.content);
    expect(after.slice(0, 23)).toEqual(before.slice(0, 23));
    expect(after.slice(-4)).toEqual(before.slice(-4));
    expect(result.output.content).toContain("Worth every one.");
    expect(result.output.content).not.toContain("You're late.");
    expect(result.output.changeSummary.map((c) => c.request)).toEqual([
      "ending_weak",
      "note",
      "comment 1",
    ]);
  });

  it("requires a change-summary entry for every request", () => {
    const missing = { ...output, changeSummary: output.changeSummary.slice(0, 1) };
    expect(scriptReviser.check(missing, input)).toEqual([
      'changeSummary has no entry with request "note"; every request needs one',
      'changeSummary has no entry with request "comment 1"; every request needs one',
    ]);
  });

  it("rejects overlapping, out-of-range and no-op edits", () => {
    expect(
      validateLineEdits(
        [
          { startLine: 3, endLine: 5, replacement: "x" },
          { startLine: 5, endLine: 6, replacement: "y" },
          { startLine: 40, endLine: 41, replacement: "12| z" },
        ],
        32,
      ),
    ).toHaveLength(3); // overlap, past the end, numbered replacement
    const noop = { ...output, edits: [{ startLine: 1, endLine: 1, replacement: "FADE IN:" }] };
    expect(scriptReviser.check(noop, input)).toEqual([
      "the edits do not change the script; apply the requested changes",
    ]);
  });

  it("supports deletion and insertion", () => {
    const content = "a\nb\nc\nd";
    expect(applyLineEdits(content, [{ startLine: 2, endLine: 3, replacement: "" }])).toBe("a\nd");
    expect(applyLineEdits(content, [{ startLine: 1, endLine: 1, replacement: "a\nnew" }])).toBe(
      "a\nnew\nb\nc\nd",
    );
  });

  it("locates anchored comments and lists the catalogue in the prompt", () => {
    const prompt = scriptReviser.build(input);
    const user = partText(prompt.messages[0]?.content[0]) ?? "";
    expect(user).toContain("comment 1 (line 28)");
    expect(user).toContain('- ending_weak ("The ending is weak")');
    expect(user).toContain("28| Forty years. You're late.");
    expect(prompt.system[0]?.text).toContain('pacing_slow ("Pacing is too slow")');
  });

  it("requires at least one request in the review", () => {
    const empty = scriptReviserInputSchema.safeParse({
      ...inputJson,
      review: { issueCodes: [], comments: [] },
    });
    expect(empty.success).toBe(false);
    const unknown = scriptReviserInputSchema.safeParse({
      ...inputJson,
      review: { issueCodes: ["boring"] },
    });
    expect(unknown.success).toBe(false);
  });
});
