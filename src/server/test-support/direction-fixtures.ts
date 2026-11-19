/**
 * Integration-test support: a Director block (output_22) a clip can be reviewed against. Built to
 * pass the Director's own block schema, with the asset ids the review compares (`char_1`, ...).
 * Tests only.
 */
import type { DirectorBlock } from "@/server/damis";

export type DirectionOptions = {
  /** The Director's block number (1-based). */
  blockId?: number;
  /** One window per shot: `["0-4s", "4-9s"]`. */
  windows?: string[];
  /** Director id to the asset's name (`{ char_1: "Tomas" }`). */
  assetNames?: Record<string, string>;
  endState?: string;
  inProgressAtEnd?: string;
};

export function testDirection(options: DirectionOptions = {}): DirectorBlock & {
  asset_names: Record<string, string>;
} {
  const windows = options.windows ?? ["0-1s"];
  const staging = (side: "frame-left" | "frame-right") => [
    {
      character_id: "char_1",
      on_screen: true,
      position: "at the lamp",
      posture: "standing",
      facing: "the sea",
      gaze: "out to sea",
      screen_side: side,
      distances: [],
    },
  ];
  return {
    block_id: options.blockId ?? 1,
    version: 1,
    duration_s: 15,
    scene_ids: ["s1"],
    scene_heading: "INT. LIGHTHOUSE - NIGHT",
    dramatic_function: "setup",
    script_coverage: { start_quote: "TOMAS climbs", end_quote: "the stairs." },
    start_state: "Tomas at the foot of the stairs.",
    end_state: options.endState ?? "Tomas at the top.",
    start_staging: staging("frame-left"),
    end_staging: staging("frame-right"),
    staging_meaning: "He moves from doubt to resolve.",
    opening_frame: "Tomas at the foot of the stairs.",
    in_progress_at_end: options.inProgressAtEnd ?? "",
    continuity: { type: "first", note: "", use_last_frame_as_start: false },
    assets: { characters: ["char_1"], locations: ["loc_1"], props: [], heard_only: [] },
    budgets: { spoken_words: 0, spoken_words_max: 0, events: 2, shot_budget: "standard" },
    camera_rationale: "A steady low angle.",
    editing_rationale: "One take.",
    shots: windows.map((window, i) => ({
      window,
      shot_number: i + 1,
      owner: "char_1",
      shot: "medium",
      angle: "eye level",
      camera_height: "eye",
      camera: "static",
      action: "Tomas climbs.",
      staging_change: "",
      default_avoided: "",
      default_kept_reason: "",
      cut_reason: i === 0 ? "" : "new beat",
      dialogue: [],
    })),
    applied_rules: [],
    prompt_text: "Tomas @char_1 climbs the stairs of @loc_1.",
    word_count: 8,
    asset_names: { char_1: "Tomas", loc_1: "Lighthouse", ...options.assetNames },
  };
}

const FIXTURE_NAMES: Record<string, { kind: "character" | "location" | "prop"; name: string }> = {
  char_1: { kind: "character", name: "Nora" },
  char_2: { kind: "character", name: "Lina" },
  char_3: { kind: "character", name: "Sam" },
  loc_1: { kind: "location", name: "Kitchen" },
  loc_2: { kind: "location", name: "Front Step" },
  prop_1: { kind: "prop", name: "Blue Kettle" },
  prop_2: { kind: "prop", name: "Scarf" },
};

/**
 * Block `n` (1 to 4) of the Director's own fixture output: a block Block Revision accepts as the
 * block to revise (full prompt, three 5-second shots). Its assets are Nora, Lina, Sam, the Kitchen
 * and, in block 2, the Blue Kettle (`insertTestDirection` binds those names).
 */
export async function fixtureDirection(n: number) {
  const { default: output } = await import("@/server/damis/director/fixtures/model-output.json");
  const block = output.blocks[n - 1];
  if (!block) throw new Error(`the fixture has no block ${n}`);
  return {
    ...structuredClone(block),
    asset_names: Object.fromEntries(Object.entries(FIXTURE_NAMES).map(([id, v]) => [id, v.name])),
  };
}

/**
 * A finished direction run for the script version, as Block Revision reads it: the frozen context
 * (platform numbers, Creative Bible, asset registry, the id bindings of `fixtureDirection`) and
 * the header's continuity bible.
 */
export async function insertTestDirection(projectId: string, scriptVersionId: string) {
  const { getDb } = await import("@/server/db/client");
  const { direction } = await import("@/server/db/schema");
  const { defaultPlatformConfig } = await import("@/server/damis");
  const { directionContextSchema } = await import("@/server/direction");
  const { default: input } = await import("@/server/damis/director/fixtures/input.json");
  const { default: output } = await import("@/server/damis/director/fixtures/model-output.json");
  const context = directionContextSchema.parse({
    platform_config: defaultPlatformConfig(),
    block_mode: "auto",
    creative_bible: input.creative_bible,
    asset_registry: input.asset_registry,
    bindings: Object.entries(FIXTURE_NAMES).map(([id, v]) => ({
      id,
      kind: v.kind,
      name: v.name,
      reference: true,
    })),
  });
  await getDb()
    .insert(direction)
    .values({
      projectId,
      scriptVersionId,
      blockMode: "auto",
      mode: "full",
      status: "ready",
      context,
      header: { continuity_bible: output.continuity_bible },
      finishedAt: new Date(),
    });
}
