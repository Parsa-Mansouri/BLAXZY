import { describe, expect, it } from "vitest";
import type { ClaudeRequest } from "../framework/client";
import { runDami } from "../framework/runner";
import { planSegments, splitLines } from "../shared/script-lines";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { absorbBlankGaps, checkRangeCoverage } from "./coverage";
import { promptSectioner } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { promptSectionerInputSchema, promptSectionerModelOutputSchema } from "./schema";
import { sectionScript, stitchSegments } from "./section-script";

const input = promptSectionerInputSchema.parse(inputJson);
const output = promptSectionerModelOutputSchema.parse(outputJson);
const lines = splitLines(input.content);

/** A fake model that answers each range request with one block per scene-ish chunk of 4 lines. */
function rangeAnswer(request: ClaudeRequest) {
  const task = JSON.stringify(request.messages[0]?.content);
  const match = /lines (\d+)-(\d+)/.exec(task);
  const start = Number(match?.[1]);
  const end = Number(match?.[2]);
  const blocks = [];
  for (let s = start; s <= end; s += 4) {
    blocks.push({
      title: `Lines ${s}`,
      startLine: s,
      endLine: Math.min(end, s + 3),
      durationSeconds: 5,
      assetRefs: ["location:harbour-pier"],
      prompt: "STYLE: test\nSCENE: Harbour Pier [location:harbour-pier] at dusk.",
    });
  }
  return Promise.resolve(jsonResponse({ blocks }));
}

describe("prompt-sectioner", () => {
  it("fixture output parses and passes the semantic checks", () => {
    expect(promptSectioner.check(output, input)).toEqual([]);
  });

  it("finalizes blocks with verbatim excerpts covering the script", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(promptSectioner, input, {}, testDeps(client).deps);
    const excerpts = result.output.blocks.map((b) => b.scriptExcerpt);
    expect(excerpts.join("\n")).toBe(lines.join("\n"));
    expect(result.output.blocks[2]?.scriptExcerpt.startsWith("INT. FERRY CABIN - CONTINUOUS")).toBe(
      true,
    );
    expect(result.output.blocks.every((b) => b.durationSeconds <= 15)).toBe(true);
  });

  it("caches the shared script context separately from the range instruction", () => {
    const prompt = promptSectioner.build({ ...input, range: { startLine: 16, endLine: 32 } });
    const [context, task] = prompt.messages[0]?.content ?? [];
    expect(context?.cache).toBe(true);
    expect(context?.text).toContain("16| INT. FERRY CABIN - CONTINUOUS");
    expect(context?.text).toContain('- character:mara "Mara"');
    expect(task?.cache).toBeUndefined();
    expect(task?.text).toContain("Cut lines 16-32");
  });

  it("reports gaps and overlaps but tolerates blank-only gaps", () => {
    const range = { startLine: 1, endLine: lines.length };
    const blocks = output.blocks.map(({ startLine, endLine }) => ({ startLine, endLine }));
    expect(checkRangeCoverage(blocks, range, lines)).toEqual([]);

    const blankGap = blocks.map((b, i) => (i === 1 ? { ...b, startLine: 9 } : b)); // line 8 is blank
    expect(checkRangeCoverage(blankGap, range, lines)).toEqual([]);
    expect(absorbBlankGaps(blankGap, range)[0]?.endLine).toBe(8);

    const gap = blocks.map((b, i) => (i === 1 ? { ...b, startLine: 10 } : b)); // line 9 has text
    expect(checkRangeCoverage(gap, range, lines)).toEqual([
      "lines 8-9 are not covered by any block (before blocks.1)",
    ]);

    const overlap = blocks.map((b, i) => (i === 1 ? { ...b, startLine: 7 } : b));
    expect(checkRangeCoverage(overlap, range, lines)[0]).toMatch(/overlaps the previous block/);

    const short = blocks.slice(0, 3);
    expect(checkRangeCoverage(short, range, lines)).toEqual([
      "lines 23-32 at the end of the range are not covered",
    ]);
  });

  it("checks asset tags against assetRefs and the asset list", () => {
    const [first, ...rest] = output.blocks;
    if (!first) throw new Error("fixture needs blocks");
    const untagged = { ...first, assetRefs: [...first.assetRefs, "character:jonas"] };
    expect(promptSectioner.check({ blocks: [untagged, ...rest] }, input)).toEqual([
      'blocks.0: "character:jonas" is in assetRefs but never tagged as [character:jonas] in the prompt',
    ]);
    const unknown = { ...first, prompt: `${first.prompt} A gull [creature:gull].` };
    expect(promptSectioner.check({ blocks: [unknown, ...rest] }, input)).toEqual([
      "blocks.0: the prompt tags [creature:gull], which is not in the asset list",
    ]);
  });
});

describe("sectionScript", () => {
  it("cuts a script segment by segment and stitches it without gaps or overlaps", async () => {
    const maxSegmentChars = 300;
    const segments = planSegments(input.content, maxSegmentChars);
    expect(segments.length).toBeGreaterThan(1);

    const client = new FakeClaudeClient(segments.map(() => rangeAnswer));
    const { deps, store } = testDeps(client);
    const result = await sectionScript(input, { projectId: "p1" }, deps, { maxSegmentChars });

    expect(result.segments).toEqual(segments);
    expect(result.runIds).toHaveLength(segments.length);
    expect(store.runs.every((r) => r.finish?.status === "succeeded")).toBe(true);
    expect(result.blocks.map((b) => b.scriptExcerpt).join("\n")).toBe(lines.join("\n"));
    result.blocks.forEach((block, i) => {
      expect(block.orderIndex).toBe(i);
      expect(input.content.replace(/\r\n?/g, "\n").slice(block.start, block.end)).toBe(
        block.scriptExcerpt,
      );
      const previous = result.blocks[i - 1];
      if (previous) expect(block.startLine).toBe(previous.endLine + 1);
    });
    // Each request names its own range; the first one ran before the others.
    const ranges = client.requests.map(
      (r) => /lines (\d+)-(\d+)/.exec(JSON.stringify(r.messages[0]?.content))?.[0],
    );
    expect(ranges[0]).toBe(`lines ${segments[0]?.startLine}-${segments[0]?.endLine}`);
    expect(new Set(ranges).size).toBe(segments.length);
    expect(result.usage.inputTokens).toBe(100 * segments.length);
    expect(result.costUsd).not.toBeNull();
  });

  it("refuses to stitch results that leave a gap", () => {
    const segments = planSegments(input.content, 300);
    const results = segments.slice(1).map((segment) => ({
      segment,
      output: {
        blocks: [
          {
            title: "x",
            scriptExcerpt: "",
            prompt: "p",
            durationSeconds: 5,
            assetRefs: [],
            startLine: segment.startLine,
            endLine: segment.endLine,
          },
        ],
      },
    }));
    expect(() => stitchSegments(input.content, results)).toThrow(/do not tile/);
  });
});
