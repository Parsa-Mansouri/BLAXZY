import { describe, expect, it } from "vitest";
import { partText } from "../framework/define";
import { runDami } from "../framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { textBlocks } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { buildTextBlocksPrompt } from "./prompt";
import { textBlocksInputSchema, textBlocksOutputSchema } from "./schema";

const input = textBlocksInputSchema.parse(inputJson);
const output = textBlocksOutputSchema.parse(outputJson);

function withPrompt(prompt: string, assetRefs = output.assetRefs) {
  return { ...output, prompt, assetRefs };
}

describe("text-blocks", () => {
  it("fixture output parses and passes the semantic checks", () => {
    expect(textBlocks.check(output, input)).toEqual([]);
  });

  it("rejects a token without a ref", () => {
    const bad = withPrompt(`${output.prompt}\nMara <<<image_4>>> looks up.`);
    expect(textBlocks.check(bad, input)).toEqual([
      "<<<image_4>>> has no ref: assetRefs has 3 entries",
    ]);
  });

  it("rejects a ref that is never called and non-contiguous tokens", () => {
    const bad = withPrompt(output.prompt.replace("<<<image_3>>>", "").replace("locket ", "locket"));
    expect(textBlocks.check(bad, input)).toContain(
      "assetRefs entry 3 is never called: <<<image_3>>> is missing from the prompt",
    );
    const gap = withPrompt(output.prompt.replace("<<<image_3>>>", "<<<image_5>>>"));
    const issues = textBlocks.check(gap, input);
    expect(issues).toContain("<<<image_5>>> has no ref: assetRefs has 3 entries");
    expect(issues).toContain(
      "assetRefs entry 3 is never called: <<<image_3>>> is missing from the prompt",
    );
  });

  it("rejects malformed tokens and leftover tags", () => {
    const malformed = withPrompt(output.prompt.replace("<<<image_2>>>", "<<<image_02>>>"));
    expect(textBlocks.check(malformed, input)).toContain(
      '"<<<image_02>>>" is not a valid token; write <<<image_N>>> with N from 1',
    );
    const tagged = withPrompt(`${output.prompt}\nThe ferry [prop:Ferry] leaves.`);
    expect(textBlocks.check(tagged, input)).toContain(
      "the prompt still contains the tag [prop:Ferry]; replace it with its token or remove it",
    );
  });

  it("rejects refs that were not passed in, voices, repeats and too many refs", () => {
    const unknown = withPrompt(`${output.prompt} Ines <<<image_4>>>`, [
      ...output.assetRefs,
      "character:Ines",
    ]);
    expect(textBlocks.check(unknown, input)).toContain(
      'assetRefs has "character:Ines", which is not in the asset list',
    );
    const voice = withPrompt(`${output.prompt} Mara <<<image_4>>>`, [
      ...output.assetRefs,
      "voice:Mara (voice)",
    ]);
    expect(textBlocks.check(voice, input)).toContain(
      'assetRefs has "voice:Mara (voice)", a voice; voices are never image references',
    );
    const repeat = withPrompt(`${output.prompt} Mara <<<image_4>>>`, [
      ...output.assetRefs,
      "character:Mara",
    ]);
    expect(textBlocks.check(repeat, input)).toContain(
      'assetRefs lists "character:Mara" more than once',
    );
    const refs = Array.from({ length: 10 }, (_, i) => `prop:thing-${i}`);
    const many = withPrompt(
      refs.map((_, i) => `<<<image_${i + 1}>>>`).join(" ") + " text here",
      refs,
    );
    expect(textBlocks.check(many, input)).toContain(
      "assetRefs has 10 entries; the video model takes at most 9",
    );
  });

  it("does not let an available asset named in the block be dropped", () => {
    const dropped = {
      ...output,
      prompt: output.prompt.replace(" <<<image_3>>>", ""),
      assetRefs: output.assetRefs.slice(0, 2),
    };
    expect(textBlocks.check(dropped, input)).toEqual([
      '"prop:Brass locket" is named in the block and available, but is not in assetRefs; reference it',
    ]);
  });

  it("builds a stable, cache-ordered prompt", () => {
    const a = buildTextBlocksPrompt(input);
    expect(a).toEqual(buildTextBlocksPrompt(textBlocksInputSchema.parse(inputJson)));
    expect(a.system.map((p) => p.cache)).toEqual([true, true]);
    const system = a.system.map((p) => p.text).join("\n");
    expect(system).toContain("<<<image_N>>>");
    expect(system).not.toContain(input.block.prompt);
    const user = a.messages[0]?.content.map(partText).join("\n") ?? "";
    expect(user).toContain(input.block.prompt);
    expect(user).toContain("- voice:Mara (voice) (voice: never an image reference)");
    expect(user).toContain("<previous_tail>");
  });

  it("runs through the runner", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(textBlocks, input, {}, testDeps(client).deps);
    expect(result.output.assetRefs).toEqual(output.assetRefs);
  });
});
