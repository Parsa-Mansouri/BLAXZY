/**
 * The craft pipeline end to end without a database, in sample mode: sample film-director, sample
 * cinematographer (look and every scene), the Breakdown's plan, and the sample v1.4 writer over
 * every write batch. Every written block must pass the Director's own checks, including the new
 * shot-plan check, so the stored blocks keep the output_22 contract.
 */
import { describe, expect, it } from "vitest";
import {
  checkDirector,
  checkShotPlan,
  cinematographerBible,
  cinematographerOutputSchema,
  defaultPlatformConfig,
  directorInputSchema,
  directorOutputSchema,
  filmDirectorInputSchema,
  shotPlanSchema,
  type BlockMode,
  type FilmDirectorInput,
} from "@/server/damis";
import fdFixture from "@/server/damis/film-director/fixtures/input.json";
import { sampleCinematographer } from "@/server/damis/sample/cinematographer";
import { sampleDirector } from "@/server/damis/sample/director";
import { sampleFilmDirector } from "@/server/damis/sample/film-director";
import { batchRanges } from "./context";
import {
  assetLabel,
  buildCraftPlan,
  lookScenesFor,
  sceneIdsOf,
  sceneInputFor,
  writerInputsFor,
} from "./craft-plan";

/** Scenes tagged A, B, C... (a number tag would make "1." a prefix of "10." in the quotes). */
function longScript(scenes: number): string {
  return Array.from({ length: scenes }, (_, i) => String.fromCharCode(65 + i))
    .map((tag) =>
      [
        `INT. ROOM ${tag} - NIGHT`,
        "",
        `Nora stands by the window of room ${tag}, holding a brass key.`,
        "",
        "NORA",
        `Room ${tag} is quiet tonight.`,
        "",
        "LINA",
        "(softly)",
        `Then stay a little longer, ${tag}.`,
        "",
      ].join("\n"),
    )
    .join("\n");
}

function pipeline(raw: unknown, blockMode: BlockMode) {
  const input: FilmDirectorInput = filmDirectorInputSchema.parse({
    ...(raw as object),
    block_mode: blockMode,
  });
  const shotPlan = shotPlanSchema.parse(sampleFilmDirector(input));
  expect(checkShotPlan(shotPlan, input)).toEqual([]);
  const registry = input.asset_registry;
  const lookOut = cinematographerOutputSchema.parse(
    sampleCinematographer({
      mode: "look",
      cinematographer_id: "deakins",
      creative_bible: cinematographerBible(input.creative_bible),
      scenes: lookScenesFor(shotPlan, registry),
    }),
  );
  const look = lookOut.look;
  if (!look) throw new Error("no look");
  const scenes = sceneIdsOf(shotPlan).map((sceneId) => {
    const scene = sampleCinematographer(
      sceneInputFor({ plan: shotPlan, registry, look, cinematographerId: "deakins", sceneId }),
    ).scene;
    if (!scene) throw new Error("no scene");
    return scene;
  });
  const context = {
    platform_config: defaultPlatformConfig(),
    block_mode: blockMode,
    creative_bible: input.creative_bible,
    asset_registry: registry,
  };
  const craft = buildCraftPlan({ shotPlan, look, context, title: "Test film" });
  const written = batchRanges(craft.plan.blocks.length).flatMap((range) => {
    const inputs = writerInputsFor({
      shotPlan,
      breakdown: craft.breakdown,
      plan: craft.plan,
      look,
      scenes,
      ...range,
    });
    const directorInput = directorInputSchema.parse({
      mode: "write_blocks",
      ...context,
      script: input.script,
      plan: craft.plan,
      block_range: `${range.from}-${range.to}`,
      ...inputs,
    });
    const output = directorOutputSchema.parse(sampleDirector(directorInput));
    expect(checkDirector(output, directorInput)).toEqual([]);
    return output.blocks;
  });
  return { shotPlan, craft, written };
}

describe("craft pipeline (sample mode, no database)", () => {
  it("fixed_15 on the fixture: every block passes the Director's checks and follows the plan", () => {
    const { shotPlan, craft, written } = pipeline(fdFixture, "fixed_15");
    expect(written.map((b) => b.block_id)).toEqual(craft.plan.blocks.map((b) => b.block_id));
    expect(written.every((b) => b.duration_s === 15)).toBe(true);
    // Every shot is in exactly one block, in order.
    expect(craft.breakdown.flatMap((b) => b.shot_ids)).toEqual(
      shotPlan.shots.map((s) => s.shot_id),
    );
    // Descriptors are labels pointing at the references, pasted into every prompt.
    const nora = craft.plan.continuity_bible.characters.find((c) => c.asset_id === "char_1");
    expect(nora?.descriptor).toBe(assetLabel("character", "Nora"));
    for (const block of written.filter((b) => b.assets.characters.includes("char_1"))) {
      expect(block.prompt_text).toContain(assetLabel("character", "Nora"));
    }
  });

  it("fixed_30 and auto on the fixture pass too", () => {
    const thirty = pipeline(fdFixture, "fixed_30");
    expect(thirty.written.every((b) => b.duration_s === 30)).toBe(true);
    const auto = pipeline(fdFixture, "auto");
    expect(auto.written.every((b) => b.duration_s === 15 || b.duration_s === 30)).toBe(true);
  });

  it("a long script runs over several write batches", () => {
    const raw = { ...fdFixture, script: longScript(12) };
    const { craft, written } = pipeline(raw, "fixed_15");
    expect(batchRanges(craft.plan.blocks.length).length).toBeGreaterThan(1);
    expect(written).toHaveLength(craft.plan.blocks.length);
    expect(craft.plan.totals.block_count).toBe(craft.plan.blocks.length);
  });
});
