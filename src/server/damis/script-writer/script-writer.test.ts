import { describe, expect, it } from "vitest";
import { runDami } from "../framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { scriptWriter } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { scriptWriterInputSchema, scriptWriterOutputSchema } from "./schema";

const input = scriptWriterInputSchema.parse(inputJson);
const output = scriptWriterOutputSchema.parse(outputJson);

describe("script-writer", () => {
  it("fixture output parses and passes the semantic checks", () => {
    expect(scriptWriter.check(output, input)).toEqual([]);
  });

  it("runs end to end with a fake client, streaming", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(scriptWriter, input, {}, testDeps(client).deps);
    expect(result.output).toEqual(output);
    expect(client.methods).toEqual(["stream"]);
    expect(client.requests[0]?.model).toBe("claude-opus-5-5");
  });

  it("puts the brief in the user message and the craft rules in the cached system prompt", () => {
    const prompt = scriptWriter.build(input);
    const system = prompt.system.map((p) => p.text).join("\n");
    expect(system).toContain("Length is a hard requirement");
    expect(system).toContain("What generative video can and cannot film");
    expect(system).toContain("## Genre: Drama");
    expect(system).toContain("## Orientation: portrait");
    const user = prompt.messages[0]?.content[0]?.text ?? "";
    expect(user).toContain(
      "<brief>\nTwo old lovers meet again on the last ferry of the night.\n</brief>",
    );
    expect(user).toContain("about 170 words");
  });

  it("checks episode structure for a series and length", () => {
    const series = scriptWriterInputSchema.parse({
      ...inputJson,
      style: {
        ...inputJson.style,
        format: "series",
        totalDurationSeconds: 180,
        episodeDurationSeconds: 60,
      },
    });
    expect(scriptWriter.check(output, series)).toContain(
      'content has 0 "EPISODE n: TITLE" headings but the series has 3 episodes',
    );
    const long = scriptWriterInputSchema.parse({
      ...inputJson,
      style: { ...inputJson.style, totalDurationSeconds: 1200 },
    });
    expect(scriptWriter.check(output, long)[0]).toMatch(/target is about 3400 words/);
  });

  it("accepts an empty script only with notes explaining why", () => {
    expect(scriptWriter.check({ ...output, content: "", notes: [] }, input)).toHaveLength(1);
    expect(
      scriptWriter.check({ ...output, content: "", notes: ["Cannot write this."] }, input),
    ).toEqual([]);
  });
});
