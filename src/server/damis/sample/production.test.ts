import { describe, expect, it } from "vitest";
import type { ProjectStyle } from "@/server/db/schema";
import { blockReviser } from "../block-reviser/dami";
import { BLOCK_ISSUE_CODES } from "../block-reviser/issues";
import { blockReviserOutputSchema } from "../block-reviser/schema";
import { DAMIS } from "../index";
import { runDami } from "../framework/runner";
import { MAX_REFERENCE_IMAGES } from "../shared/block";
import { takeFixer } from "../take-fixer/dami";
import { TAKE_ISSUE_CODES } from "../take-fixer/issues";
import { takeFixerOutputSchema } from "../take-fixer/schema";
import { textBlocks } from "../text-blocks/dami";
import { textBlocksOutputSchema } from "../text-blocks/schema";
import { testDeps } from "../test-utils";
import { createSampleClaudeClient, SAMPLE_GENERATORS } from "./client";
import { sampleBlockReviser, sampleTakeFixer, sampleTextBlocks } from "./production";

const style: ProjectStyle = {
  visualStyle: "2D animation",
  genre: "Comedy",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: 120,
};

type AssetIn = {
  ref: string;
  kind: "character" | "location" | "prop" | "voice";
  name: string;
  description?: string;
};

// A non-English name goes with an ASCII slug: refs are always kind:slug.
const BASE_ASSETS: AssetIn[] = [
  { ref: "character:ines", kind: "character", name: "Ines", description: "Young woman, red coat." },
  { ref: "character:maryam", kind: "character", name: "مریم" },
  { ref: "location:cafe-muller", kind: "location", name: "Café Müller" },
  { ref: "prop:map", kind: "prop", name: "Old map" },
  { ref: "voice:ines", kind: "voice", name: "Ines (voice)" },
];

function blockOf(prompt: string, refs: string[]) {
  return {
    title: "Sc 1 · The map",
    scriptExcerpt: "INT. CAFE - DAY\nInes turns the map over.",
    prompt,
    durationSeconds: 8,
    assetRefs: refs,
  };
}

const PROMPT = [
  "SCENE: Café Müller [location:cafe-muller], interior, day.",
  "CAST: Ines [character:ines], young woman in a red coat. مریم [character:maryam], in a blue scarf.",
  'SHOT 1 (0-8s): MEDIUM, static. Ines turns the old map [prop:map] over. Ines [voice:ines] (quiet): "Here." The ferry [prop:ferry] hoots. Ines [character:ines] smiles.',
].join("\n");
const REFS = [
  "location:cafe-muller",
  "character:ines",
  "character:maryam",
  "prop:map",
  "voice:ines",
  "prop:ferry",
];

function run(assets: AssetIn[], prompt = PROMPT, refs = REFS, previous?: object) {
  const input = { style, block: blockOf(prompt, refs), assets, previous };
  const raw = sampleTextBlocks(input);
  const output = textBlocksOutputSchema.parse(raw);
  const parsed = textBlocks.input.parse(input);
  return { output, issues: textBlocks.check(output, parsed) };
}

describe("sample text-blocks", () => {
  it("binds the available assets in order of first appearance and passes the check", () => {
    const { output, issues } = run(BASE_ASSETS);
    expect(issues).toEqual([]);
    expect(output.assetRefs).toEqual([
      "location:cafe-muller",
      "character:ines",
      "character:maryam",
      "prop:map",
    ]);
    expect(output.prompt).toContain("Café Müller <<<image_1>>>");
    expect(output.prompt).toContain("Ines <<<image_2>>>");
    expect(output.prompt).toContain("مریم <<<image_3>>>");
    expect(output.prompt).toContain("old map <<<image_4>>>");
    // The voice and the unavailable prop keep their names and lose their tags.
    expect(output.prompt).toContain('Ines (quiet): "Here."');
    expect(output.prompt).toContain("The ferry hoots.");
    expect(output.prompt).not.toContain("[");
    expect(output.notes).toEqual([
      '"prop:ferry" has no reference sheet yet; it is named in words only.',
    ]);
  });

  it("works with no assets at all", () => {
    const { output, issues } = run([]);
    expect(issues).toEqual([]);
    expect(output.assetRefs).toEqual([]);
    expect(output.prompt).not.toContain("<<<");
    expect(output.notes).toHaveLength(REFS.length);
  });

  it("keeps characters, then the location, then props when there are more than the limit", () => {
    const refs: string[] = [];
    const assets: AssetIn[] = [];
    const lines: string[] = [];
    for (let i = 0; i < 6; i++) {
      assets.push({ ref: `prop:thing-${i}`, kind: "prop", name: `Thing ${i}` });
      refs.push(`prop:thing-${i}`);
      lines.push(`Thing ${i} [prop:thing-${i}]`);
    }
    assets.push({ ref: "location:hall", kind: "location", name: "Hall" });
    refs.push("location:hall");
    lines.push("Hall [location:hall]");
    for (let i = 0; i < 4; i++) {
      assets.push({ ref: `character:c-${i}`, kind: "character", name: `Char ${i}` });
      refs.push(`character:c-${i}`);
      lines.push(`Char ${i} [character:c-${i}]`);
    }
    const { output, issues } = run(assets, lines.join(". "), refs);
    expect(issues).toEqual([]);
    expect(output.assetRefs).toHaveLength(MAX_REFERENCE_IMAGES);
    for (let i = 0; i < 4; i++) expect(output.assetRefs).toContain(`character:c-${i}`);
    expect(output.assetRefs).toContain("location:hall");
    // Two props are dropped, the last two named, each with a note.
    expect(output.assetRefs).not.toContain("prop:thing-4");
    expect(output.assetRefs).not.toContain("prop:thing-5");
    expect(output.notes).toHaveLength(2);
    expect(output.prompt).toContain("Thing 4.");
  });

  it("adds a short continuity line without tokens from the previous block", () => {
    const { output, issues } = run(BASE_ASSETS, PROMPT, REFS, {
      title: "Sc 1 · Before",
      promptTail: "Ines <<<image_1>>> [character:ines] stands by the window in her red coat.",
    });
    expect(issues).toEqual([]);
    expect(output.prompt).toContain('CONTINUITY: picks up from "Sc 1 · Before"');
    expect(output.prompt).toContain("stands by the window in her red coat.");
    expect(output.prompt.match(/<<<image_1>>>/g)).toHaveLength(1);
  });

  it("is deterministic and runs through the sample client", async () => {
    expect(run(BASE_ASSETS).output).toEqual(run(BASE_ASSETS).output);
    const input = { style, block: blockOf(PROMPT, REFS), assets: BASE_ASSETS };
    const deps = testDeps(createSampleClaudeClient({ delayMs: 0 })).deps;
    const result = await runDami(textBlocks, input, {}, deps);
    expect(result.output.assetRefs).toHaveLength(4);
  });
});

describe("sample block-reviser and take-fixer", () => {
  const review = { issueCodes: ["wrong_camera", "tone_off"], note: "Closer on her hands." };

  it("block-reviser reflects every request and passes the check", () => {
    const prompt = "SCENE: Hall <<<image_1>>>. Ines <<<image_2>>> walks in.";
    const input = {
      style,
      block: {
        title: "t",
        scriptExcerpt: "Ines walks in.",
        prompt,
        assetRefs: ["location:hall", "character:ines"],
      },
      assets: [
        { ref: "location:hall", kind: "location", name: "Hall" },
        { ref: "character:ines", kind: "character", name: "Ines" },
      ],
      review,
    };
    const output = blockReviserOutputSchema.parse(sampleBlockReviser(input));
    expect(blockReviser.check(output, blockReviser.input.parse(input))).toEqual([]);
    expect(output.changeSummary.map((c) => c.request)).toEqual([
      "wrong_camera",
      "tone_off",
      "note",
    ]);
    expect(output.prompt).toContain("Closer on her hands.");
    expect(output.assetRefs).toEqual(["location:hall", "character:ines"]);
  });

  it("take-fixer reflects every request and keeps the tokens, for both stages", () => {
    for (const stage of ["draft", "final"] as const) {
      const input = {
        style,
        block: { title: "t", scriptExcerpt: "Ines walks in." },
        previousPrompt: "SCENE: Hall <<<image_1>>>. Ines <<<image_2>>> walks in.",
        assetRefs: ["location:hall", "character:ines"],
        stage,
        review: { issueCodes: ["face_distorted"], note: "Slower." },
      };
      const output = takeFixerOutputSchema.parse(sampleTakeFixer(input));
      expect(takeFixer.check(output, takeFixer.input.parse(input))).toEqual([]);
      expect(output.prompt).toContain(`RETRY (${stage})`);
      expect(output.prompt).toContain("Slower.");
      expect(output.changeSummary.map((c) => c.request)).toEqual(["face_distorted", "note"]);
    }
  });

  it("handles every catalogue code", () => {
    const blockInput = {
      style,
      block: {
        title: "t",
        scriptExcerpt: "x",
        prompt: "Ines <<<image_1>>> walks in.",
        assetRefs: ["character:ines"],
      },
      assets: [{ ref: "character:ines", kind: "character", name: "Ines" }],
      review: { issueCodes: [...BLOCK_ISSUE_CODES] },
    };
    expect(
      blockReviser.check(
        blockReviserOutputSchema.parse(sampleBlockReviser(blockInput)),
        blockReviser.input.parse(blockInput),
      ),
    ).toEqual([]);
    const takeInput = {
      style,
      block: { title: "t", scriptExcerpt: "x" },
      previousPrompt: "Ines <<<image_1>>> walks in.",
      assetRefs: ["character:ines"],
      stage: "draft",
      review: { issueCodes: [...TAKE_ISSUE_CODES] },
    };
    expect(
      takeFixer.check(
        takeFixerOutputSchema.parse(sampleTakeFixer(takeInput)),
        takeFixer.input.parse(takeInput),
      ),
    ).toEqual([]);
  });

  it("every registered dami has a sample generator", () => {
    for (const key of Object.keys(DAMIS)) expect(SAMPLE_GENERATORS[key]).toBeTypeOf("function");
  });
});
