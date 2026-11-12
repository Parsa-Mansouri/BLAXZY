import { describe, expect, it } from "vitest";
import { partText } from "../framework/define";
import { runDami } from "../framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { blockReviser } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { BLOCK_ISSUE_CODES, BLOCK_ISSUE_LIST, BLOCK_ISSUES } from "./issues";
import { buildBlockReviserPrompt } from "./prompt";
import { blockIssueCodeSchema, blockReviserInputSchema, blockReviserOutputSchema } from "./schema";

const input = blockReviserInputSchema.parse(inputJson);
const output = blockReviserOutputSchema.parse(outputJson);

describe("block issue catalogue", () => {
  it("has about ten complete entries with unique codes", () => {
    expect(BLOCK_ISSUE_LIST.length).toBeGreaterThanOrEqual(10);
    expect(BLOCK_ISSUE_LIST.length).toBeLessThanOrEqual(12);
    expect(new Set(BLOCK_ISSUE_CODES).size).toBe(BLOCK_ISSUE_CODES.length);
    expect(BLOCK_ISSUE_LIST.map((i) => i.code)).toEqual([...BLOCK_ISSUE_CODES]);
    for (const code of BLOCK_ISSUE_CODES) {
      const issue = BLOCK_ISSUES[code];
      expect(issue.code).toBe(code);
      expect(issue.label.length).toBeGreaterThan(0);
      expect(issue.hint.length).toBeGreaterThan(0);
      expect(issue.instruction.length).toBeGreaterThan(40);
      expect(blockIssueCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(blockIssueCodeSchema.safeParse("nope").success).toBe(false);
  });
});

describe("block-reviser", () => {
  it("fixture output parses and passes the semantic checks", () => {
    expect(blockReviser.check(output, input)).toEqual([]);
  });

  it("needs a code or a note, and rejects unknown codes", () => {
    expect(blockReviserInputSchema.safeParse({ ...inputJson, review: {} }).success).toBe(false);
    expect(
      blockReviserInputSchema.safeParse({ ...inputJson, review: { issueCodes: ["bogus"] } })
        .success,
    ).toBe(false);
    expect(
      blockReviserInputSchema.safeParse({ ...inputJson, review: { note: "Closer." } }).success,
    ).toBe(true);
  });

  it("requires one change-summary entry per request and a changed prompt", () => {
    const missing = { ...output, changeSummary: output.changeSummary.slice(0, 1) };
    expect(blockReviser.check(missing, input)).toEqual([
      'changeSummary has no entry with request "too_much_happening"; every request needs one',
      'changeSummary has no entry with request "note"; every request needs one',
    ]);
    const same = { ...output, prompt: input.block.prompt };
    expect(blockReviser.check(same, input)).toEqual([
      "the prompt is unchanged; apply the requested changes",
    ]);
  });

  it("applies the token rules, and lets the asset list change", () => {
    const badToken = { ...output, prompt: `${output.prompt} Mara <<<image_4>>>` };
    expect(blockReviser.check(badToken, input)).toEqual([
      "<<<image_4>>> has no ref: assetRefs has 3 entries",
    ]);
    const voice = {
      ...output,
      prompt: `${output.prompt} Mara <<<image_4>>>`,
      assetRefs: [...output.assetRefs, "voice:Mara (voice)"],
    };
    expect(blockReviser.check(voice, input)).toEqual([
      'assetRefs has "voice:Mara (voice)", a voice; voices are never image references',
    ]);
    const removed = {
      ...output,
      prompt: output.prompt
        .replace(" <<<image_3>>>", "")
        .replace("brass locket", "small brass locket"),
      assetRefs: output.assetRefs.slice(0, 2),
    };
    expect(blockReviser.check(removed, input)).toEqual([]);
    const unknown = { ...output, assetRefs: ["location:Nowhere", ...output.assetRefs.slice(1)] };
    expect(blockReviser.check(unknown, input)).toEqual([
      'assetRefs has "location:Nowhere", which is not in the asset list',
    ]);
  });

  it("builds a stable, cache-ordered prompt that lists the catalogue", () => {
    const a = buildBlockReviserPrompt(input);
    expect(a).toEqual(buildBlockReviserPrompt(blockReviserInputSchema.parse(inputJson)));
    expect(a.system.map((p) => p.cache)).toEqual([true, true]);
    const system = a.system.map((p) => p.text).join("\n");
    for (const code of BLOCK_ISSUE_CODES) expect(system).toContain(`- ${code} (`);
    expect(system).not.toContain(input.block.prompt);
    const user = a.messages[0]?.content.map(partText).join("\n") ?? "";
    expect(user).toContain(input.block.prompt);
    expect(user).toContain("<<<image_1>>> = location:Harbour Pier");
    expect(user).toContain('wrong_camera ("Wrong shot size or camera")');
    expect(user).toContain("Keep Mara on the planks the whole time.");
  });

  it("runs through the runner", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(blockReviser, input, {}, testDeps(client).deps);
    expect(result.output.changeSummary.map((c) => c.request)).toEqual([
      "wrong_camera",
      "too_much_happening",
      "note",
    ]);
  });
});
