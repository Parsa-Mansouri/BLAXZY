import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { partText } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { runDami } from "../framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { enhancer } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import {
  ENHANCER_BASE,
  ENHANCER_CORE,
  ENHANCER_EXAMPLES,
  ENHANCER_GENRE_BLOCKS,
  ENHANCER_STYLE_BLOCKS,
} from "./prompt";
import {
  enhancerInputSchema,
  enhancerOutputSchema,
  OWNER_ENHANCER_GENRES,
  OWNER_ENHANCER_STYLES,
} from "./schema";

const input = enhancerInputSchema.parse(inputJson);
const output = enhancerOutputSchema.parse(outputJson);

const lf = (text: string) => text.replace(/\r\n/g, "\n");

describe("enhancer", () => {
  it("fixture output parses and passes the semantic checks", () => {
    expect(enhancer.check(output, input)).toEqual([]);
  });

  it("runs end to end with a fake client on Sonnet", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(enhancer, input, {}, testDeps(client).deps);
    expect(result.output).toEqual(output);
    expect(client.requests[0]?.model).toBe(CLAUDE_MODELS.sonnet);
    expect(CLAUDE_MODELS.sonnet).toBe("claude-sonnet-5-5");
  });

  it("only accepts the owner's genre and style names, or null", () => {
    expect(enhancerInputSchema.safeParse({ ...inputJson, genre: "Other" }).success).toBe(false);
    expect(enhancerInputSchema.safeParse({ ...inputJson, visualStyle: "Pixar" }).success).toBe(
      false,
    );
    expect(
      enhancerInputSchema.safeParse({ ...inputJson, genre: null, visualStyle: null }).success,
    ).toBe(true);
    expect(enhancerInputSchema.safeParse({ ...inputJson, userPrompt: "   " }).success).toBe(false);
  });

  it("puts only the selected genre and style blocks in the system prompt", () => {
    const prompt = enhancer.build(input);
    expect(prompt.system).toHaveLength(3);
    expect(prompt.system[0]).toEqual({ text: ENHANCER_BASE, cache: true });
    expect(ENHANCER_BASE.indexOf(ENHANCER_EXAMPLES)).toBeGreaterThan(ENHANCER_CORE.length - 1);
    expect(prompt.system[1]?.text).toBe(
      `<genre_rules name="Comedy">\n${ENHANCER_GENRE_BLOCKS.Comedy}\n</genre_rules>`,
    );
    expect(prompt.system[1]?.cache).toBeUndefined();
    expect(prompt.system[2]?.text).toBe(
      `<style_rules name="3D Animation">\n${ENHANCER_STYLE_BLOCKS["3D Animation"]}\n</style_rules>`,
    );
    expect(prompt.system[2]?.cache).toBe(true);
    const system = prompt.system.map((p) => p.text).join("\n");
    for (const genre of OWNER_ENHANCER_GENRES.filter((g) => g !== "Comedy")) {
      expect(system).not.toContain(ENHANCER_GENRE_BLOCKS[genre]);
    }
    for (const style of OWNER_ENHANCER_STYLES.filter((s) => s !== "3D Animation")) {
      expect(system).not.toContain(ENHANCER_STYLE_BLOCKS[style]);
    }
    const breakpoints = prompt.system.filter((p) => p.cache).length;
    expect(breakpoints).toBeLessThanOrEqual(4);

    const user = partText(prompt.messages[0]?.content[0]);
    expect(user.startsWith("<input>\n")).toBe(true);
    expect(user.endsWith("\n</input>")).toBe(true);
    const json: unknown = JSON.parse(user.slice("<input>\n".length, -"\n</input>".length));
    expect(json).toEqual({
      user_prompt: input.userPrompt,
      genre: "Comedy",
      visual_style: "3D Animation",
    });
  });

  it("sends no rules blocks when genre and style are inactive", () => {
    const prompt = enhancer.build({ ...input, genre: null, visualStyle: null });
    expect(prompt.system).toEqual([{ text: ENHANCER_BASE, cache: true }]);
    expect(partText(prompt.messages[0]?.content[0])).toContain('"visual_style": null');
    const genreOnly = enhancer.build({ ...input, visualStyle: null });
    expect(genreOnly.system).toHaveLength(2);
    expect(genreOnly.system[1]?.cache).toBe(true);
  });

  it("flags applied values that do not echo the input", () => {
    const wrong = { ...output, applied: { genre: "Drama", visual_style: null } };
    expect(enhancer.check(wrong, input)).toHaveLength(2);
  });

  it("requires look_line exactly when a style is active", () => {
    expect(enhancer.check({ ...output, look_line: null }, input)).toHaveLength(1);
    const noStyle = { ...input, visualStyle: null };
    const okNoStyle = { ...output, applied: { genre: "Comedy", visual_style: null } };
    expect(enhancer.check(okNoStyle, noStyle)).toHaveLength(1);
    expect(enhancer.check({ ...okNoStyle, look_line: null }, noStyle)).toEqual([]);
    const long = Array.from({ length: 61 }, () => "word").join(" ");
    expect(enhancer.check({ ...output, look_line: long }, input)).toHaveLength(1);
  });

  it("flags timestamps and an empty prompt", () => {
    const stamped = { ...output, enhanced_prompt: `[0-4s] ${output.enhanced_prompt ?? ""}` };
    expect(enhancer.check(stamped, input)[0]).toContain("[0-4s]");
    expect(
      enhancer.check({ ...output, enhanced_prompt: "A [ 2 - 5 s ] beat." }, input),
    ).toHaveLength(1);
    expect(enhancer.check({ ...output, enhanced_prompt: "  " }, input)).toHaveLength(1);
    expect(enhancer.check({ ...output, enhanced_prompt: null }, input)).toHaveLength(1);
  });

  it("checks the error shape", () => {
    const error = {
      status: "error" as const,
      enhanced_prompt: null,
      look_line: null,
      applied: { genre: null, visual_style: null },
      overrides: [],
      error: "Empty prompt.",
    };
    expect(enhancer.check(error, input)).toEqual([]);
    expect(enhancer.check({ ...error, error: " " }, input)).toHaveLength(1);
    expect(enhancer.check({ ...error, enhanced_prompt: "text" }, input)).toHaveLength(1);
  });

  it("keeps the prompt text verbatim from the owner's file", () => {
    const source = lf(
      readFileSync(new URL("./source/blaxzy_enhancer_dami.md", import.meta.url), "utf8"),
    );
    const blocks: Array<[string, string]> = [
      ["core", ENHANCER_CORE],
      ["examples", ENHANCER_EXAMPLES],
      ...OWNER_ENHANCER_GENRES.map((g): [string, string] => [g, ENHANCER_GENRE_BLOCKS[g]]),
      ...OWNER_ENHANCER_STYLES.map((s): [string, string] => [s, ENHANCER_STYLE_BLOCKS[s]]),
    ];
    for (const [name, text] of blocks) {
      expect(text.length, name).toBeGreaterThan(100);
      expect(source.includes(lf(text)), `${name} is not verbatim in the source`).toBe(true);
    }
  });
});
