import { describe, expect, it } from "vitest";
import { partText } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { runDami } from "../framework/runner";
import { sampleProjectNamer } from "../sample/project-namer";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { checkProjectName, projectNamer } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import {
  NAME_MAX_CHARS,
  NAME_STORY_MAX_CHARS,
  projectNamerInputSchema,
  projectNamerOutputSchema,
  storyExcerpt,
} from "./schema";

const input = projectNamerInputSchema.parse(inputJson);
const title = (value: string) => checkProjectName({ title: value });

describe("project-namer", () => {
  it("fixture output parses and passes the checks", () => {
    const output = projectNamerOutputSchema.parse(outputJson);
    expect(projectNamer.check(output, input)).toEqual([]);
  });

  it("runs on Haiku at low effort with a small token budget", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(projectNamer, input, {}, testDeps(client).deps);
    expect(result.output).toEqual({ title: "The Last Light" });
    const request = client.requests[0];
    expect(request?.model).toBe(CLAUDE_MODELS.haiku);
    expect(request?.max_tokens).toBe(1024);
  });

  it("puts the facts and the story in the user turn", () => {
    const prompt = projectNamer.build(input);
    const user = prompt.messages[0]?.content.map(partText).join("") ?? "";
    expect(user).toContain("Genre: Drama");
    expect(user).toContain("Visual style: Realistic");
    expect(user).toContain("<story>");
    expect(user).toContain("lighthouse keeper");
  });

  it("omits facts the project does not have", () => {
    const prompt = projectNamer.build({ ...input, genre: null, visualStyle: null, format: null });
    expect(partText(prompt.messages[0]?.content[0] ?? { text: "" })).toMatch(/^<story>/);
  });

  describe("check", () => {
    it("accepts plain titles in any language", () => {
      for (const ok of ["Salt", "The Lighthouse Keeper", "Night Ferry", "فانوس دریایی", "Up!"]) {
        expect(title(ok)).toEqual([]);
      }
    });

    it("rejects what the rules forbid", () => {
      expect(title("")).not.toEqual([]);
      expect(title(" Salt ")).not.toEqual([]);
      expect(title("x".repeat(NAME_MAX_CHARS + 1))).not.toEqual([]);
      expect(title("x".repeat(NAME_MAX_CHARS))).toEqual([]);
      expect(title('"Salt"')).not.toEqual([]);
      expect(title("“Salt”")).not.toEqual([]);
      expect(title("Salt.")).not.toEqual([]);
      expect(title("Salt\nWater")).not.toEqual([]);
      for (const generic of ["Untitled", "untitled project", "Film", "Movie"]) {
        expect(title(generic)).not.toEqual([]);
      }
    });

    it("allows an apostrophe inside a title", () => {
      expect(title("Don't Look Up")).toEqual([]);
    });
  });

  describe("storyExcerpt", () => {
    it("keeps a short story whole and cuts a long one at a word boundary", () => {
      expect(storyExcerpt("  a short story ")).toBe("a short story");
      const long = "word ".repeat(5000);
      const cut = storyExcerpt(long);
      expect(cut.length).toBeLessThanOrEqual(NAME_STORY_MAX_CHARS);
      expect(cut.endsWith("word")).toBe(true);
    });
  });

  describe("sample generator", () => {
    it("is deterministic, short and passes the checks", () => {
      const first = sampleProjectNamer(input);
      expect(sampleProjectNamer(input)).toEqual(first);
      expect(first.title).toBe("Old Lighthouse Keeper Remote");
      expect(checkProjectName(first)).toEqual([]);
    });

    it("handles short, long and non-Latin stories", () => {
      expect(sampleProjectNamer({ ...input, story: "Salt." }).title).toBe("Salt");
      const long = sampleProjectNamer({ ...input, story: "supercalifragilistic ".repeat(40) });
      expect(long.title.length).toBeLessThanOrEqual(NAME_MAX_CHARS);
      expect(checkProjectName(long)).toEqual([]);
      const persian = sampleProjectNamer({
        ...input,
        story: "پیرمرد فانوس‌بان شب آخر را می‌گذراند.",
      });
      expect(persian.title.length).toBeGreaterThan(0);
      expect(checkProjectName(persian)).toEqual([]);
    });
  });
});
