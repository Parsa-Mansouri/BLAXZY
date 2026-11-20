import { describe, expect, it } from "vitest";
import type { CreativeBible, DirectorBlock } from "@/server/damis";
import outputJson from "@/server/damis/director/fixtures/model-output.json";
import { directedBlocks } from "./blocks";
import {
  batchRanges,
  blockLengthFor,
  blockModeFor,
  estimateBlockCount,
  type DirectionBinding,
} from "./context";

const blocks = (outputJson as unknown as { blocks: DirectorBlock[] }).blocks;

describe("batch ranges and the block estimate", () => {
  it("covers 1..total in inclusive batches of eight", () => {
    expect(batchRanges(8)).toEqual([{ from: 1, to: 8 }]);
    expect(batchRanges(9)).toEqual([
      { from: 1, to: 8 },
      { from: 9, to: 9 },
    ]);
    expect(batchRanges(20).map((r) => `${r.from}-${r.to}`)).toEqual(["1-8", "9-16", "17-20"]);
  });

  const style = {
    visualStyle: "x",
    genre: "y",
    format: "movie" as const,
    orientation: "landscape" as const,
    totalDurationSeconds: 120,
  };

  it("estimates from the target runtime, or the script when it is longer", () => {
    expect(estimateBlockCount({ style, script: "short", blockLengthSec: 15 })).toBe(8);
    expect(estimateBlockCount({ style, script: "short", blockLengthSec: 30 })).toBe(4);
    const long = Array(2000).fill("word").join(" ");
    expect(estimateBlockCount({ style, script: long, blockLengthSec: 15 })).toBeGreaterThan(8);
  });

  it("uses the episode runtime of a series", () => {
    expect(
      estimateBlockCount({
        style: { ...style, format: "series", episodeDurationSeconds: 60 },
        script: "s",
        blockLengthSec: 15,
      }),
    ).toBe(4);
  });

  it("blockModeFor is auto without a bible", () => {
    expect(blockModeFor(null)).toBe("auto");
  });

  it("blockModeFor lets the style's 15 or 30 s answer win over the bible", () => {
    const bible = { project_frame: { block_length_sec: 30 } } as unknown as CreativeBible;
    expect(blockModeFor(bible)).toBe("fixed_30");
    expect(blockModeFor(bible, style)).toBe("fixed_30");
    expect(blockModeFor(bible, { ...style, blockLength: "15" })).toBe("fixed_15");
    expect(blockModeFor(null, { ...style, blockLength: "30" })).toBe("fixed_30");
    // Shot by shot and unset fall back to the bible.
    expect(blockModeFor(bible, { ...style, blockLength: "shot" })).toBe("fixed_30");
    expect(blockModeFor(null, { ...style, blockLength: "shot" })).toBe("auto");
    expect(blockLengthFor(bible, 15, { ...style, blockLength: "15" })).toBe(15);
    expect(blockLengthFor(bible, 15, style)).toBe(30);
  });
});

describe("directedBlocks", () => {
  const bindings: DirectionBinding[] = [
    { id: "char_1", kind: "character", name: "Nora", reference: true },
    { id: "char_2", kind: "character", name: "Lina", reference: true },
    { id: "char_3", kind: "character", name: "Sam", reference: false },
    { id: "loc_1", kind: "location", name: "Kitchen", reference: true },
  ];

  it("keeps the raw prompt in direction and stores the prompt with kind:Name tags, in order", () => {
    const first = blocks[0] as DirectorBlock;
    const withIds: DirectorBlock = {
      ...first,
      prompt_text:
        "@loc_1 KITCHEN, evening. @char_2 LINA sits at the table. @char_1 NORA stirs the pot; @char_3 SAM watches. @char_1 NORA turns.",
      assets: {
        characters: ["char_1", "char_2", "char_3"],
        locations: ["loc_1"],
        props: [],
        heard_only: [],
      },
    };
    const [stored] = directedBlocks({
      blocks: [withIds],
      script: "x",
      bindings,
      runIds: ["run-1"],
    });
    expect(stored?.prompt).toBe(
      "Kitchen [location:Kitchen], evening. Lina [character:Lina] sits at the table. Nora [character:Nora] stirs the pot; Sam watches. Nora [character:Nora] turns.",
    );
    // Tagged assets in order of first appearance; a voice-only asset (no reference) is left out.
    expect(stored?.assetRefs).toEqual(["location:Kitchen", "character:Lina", "character:Nora"]);
    expect(stored?.direction).toMatchObject({
      ...withIds,
      asset_names: { char_1: "Nora", loc_1: "Kitchen" },
    });
    expect(stored?.durationSeconds).toBe(first.duration_s);
    expect(stored?.orderIndex).toBe(first.block_id - 1);
    expect(stored?.damiRunId).toBe("run-1");
  });
});
