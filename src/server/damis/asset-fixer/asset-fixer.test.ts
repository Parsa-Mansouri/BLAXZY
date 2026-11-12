import { describe, expect, it } from "vitest";
import { runDami } from "../framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { assetFixer } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import {
  LOOK_ISSUE_CODES,
  LOOK_ISSUE_KINDS,
  LOOK_ISSUE_LIST,
  LOOK_ISSUES,
  lookIssueFits,
  lookIssuesFor,
} from "./issues";
import { buildAssetFixerPrompt } from "./prompt";
import { assetFixerInputSchema, assetFixerOutputSchema, lookIssueCodeSchema } from "./schema";

const input = assetFixerInputSchema.parse(inputJson);
const output = assetFixerOutputSchema.parse(outputJson);

describe("look issue catalogue", () => {
  it("has 10 to 14 complete entries with unique codes", () => {
    expect(LOOK_ISSUE_LIST.length).toBeGreaterThanOrEqual(10);
    expect(LOOK_ISSUE_LIST.length).toBeLessThanOrEqual(14);
    expect(new Set(LOOK_ISSUE_CODES).size).toBe(LOOK_ISSUE_CODES.length);
    expect(LOOK_ISSUE_LIST.map((i) => i.code)).toEqual([...LOOK_ISSUE_CODES]);
    for (const code of LOOK_ISSUE_CODES) {
      const issue = LOOK_ISSUES[code];
      expect(issue.code).toBe(code);
      expect(issue.label.length).toBeGreaterThan(0);
      expect(issue.hint.length).toBeGreaterThan(0);
      expect(issue.instruction.length).toBeGreaterThan(40);
      expect(lookIssueCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(lookIssueCodeSchema.safeParse("nope").success).toBe(false);
  });
});

describe("asset-fixer", () => {
  it("fixture output parses and passes the semantic checks", () => {
    expect(assetFixer.check(output, input)).toEqual([]);
  });

  it("needs a code or a note, and rejects voices and unknown codes", () => {
    expect(assetFixerInputSchema.safeParse({ ...inputJson, review: {} }).success).toBe(false);
    expect(
      assetFixerInputSchema.safeParse({ ...inputJson, review: { issueCodes: ["bogus"] } }).success,
    ).toBe(false);
    expect(
      assetFixerInputSchema.safeParse({ ...inputJson, review: { note: "Warmer." } }).success,
    ).toBe(true);
    const voice = { ...inputJson, asset: { kind: "voice", name: "Mara (voice)" } };
    expect(assetFixerInputSchema.safeParse(voice).success).toBe(false);
  });

  it("requires one change-summary entry per request and a changed prompt", () => {
    const missing = { ...output, changeSummary: output.changeSummary.slice(0, 1) };
    expect(assetFixer.check(missing, input)).toEqual([
      'changeSummary has no entry with request "wrong_clothing"; every request needs one',
      'changeSummary has no entry with request "note"; every request needs one',
    ]);
    const extra = {
      ...output,
      changeSummary: [...output.changeSummary, { request: "ripple", change: "x" }],
    };
    expect(assetFixer.check(extra, input)).toHaveLength(1);
    const same = { ...output, prompt: input.previousPrompt };
    expect(assetFixer.check(same, input)).toEqual([
      "the prompt is unchanged; apply the requested changes",
    ]);
  });

  it("builds a stable, cache-ordered prompt that lists the catalogue", () => {
    const a = buildAssetFixerPrompt(input);
    expect(a).toEqual(buildAssetFixerPrompt(assetFixerInputSchema.parse(inputJson)));
    expect(a.system.map((p) => p.cache)).toEqual([true, true]);
    const system = a.system.map((p) => p.text).join("\n");
    for (const code of LOOK_ISSUE_CODES) expect(system).toContain(`- ${code} (`);
    expect(system).not.toContain(input.previousPrompt);
    const user = a.messages[0]?.content.map((p) => p.text).join("\n") ?? "";
    expect(user).toContain(input.previousPrompt);
    expect(user).toContain('face_incomplete ("Face not fully generated")');
    expect(user).toContain("Make the jacket dark green.");
  });

  it("runs through the runner", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(assetFixer, input, {}, testDeps(client).deps);
    expect(result.output.changeSummary.map((c) => c.request)).toEqual([
      "face_incomplete",
      "wrong_clothing",
      "note",
    ]);
  });
});

describe("look issues by kind", () => {
  const codes = (kind: Parameters<typeof lookIssuesFor>[0]) =>
    lookIssuesFor(kind).map((i) => i.code);

  it("never offers a place a face, limbs, an age, clothing or a clean backdrop", () => {
    const place = codes("location");
    for (const code of [
      "face_incomplete",
      "anatomy_wrong",
      "wrong_age",
      "wrong_clothing",
      "background_not_clean",
    ] as const) {
      expect(place).not.toContain(code);
      expect(lookIssueFits(code, "location")).toBe(false);
    }
    expect(place).toEqual(expect.arrayContaining(["extra_subjects", "lighting_poor"]));
  });

  it("offers a character everything, a costume clothing but no face, a voice nothing", () => {
    expect(codes("character")).toEqual([...LOOK_ISSUE_CODES]);
    expect(codes("creature")).toContain("anatomy_wrong");
    expect(codes("creature")).not.toContain("wrong_clothing");
    expect(codes("costume")).toContain("wrong_clothing");
    expect(codes("costume")).not.toContain("face_incomplete");
    expect(codes("prop")).not.toContain("wrong_age");
    expect(codes("voice")).toEqual([]);
  });

  it("keeps catalogue order and gives every code at least one kind", () => {
    for (const code of LOOK_ISSUE_CODES) expect(LOOK_ISSUE_KINDS[code].length).toBeGreaterThan(0);
    const prop = codes("prop");
    expect(prop).toEqual(LOOK_ISSUE_CODES.filter((c) => prop.includes(c)));
  });
});
