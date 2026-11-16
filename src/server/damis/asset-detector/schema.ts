/**
 * Asset Detector v2 (the owner's `asset_detector`, output_21). The output schema mirrors the
 * owner's `submit_output_21` tool field for field; the framework sends it as structured JSON
 * output. The detector speaks `char_1` / `loc_1` / `prop_1` ids: the worker
 * translates them to and from BLAXZY's real-name ids, so they never reach the database or the UI.
 */
import { z } from "zod";
import { creativeDnaTextSchema } from "../shared/creative-dna-input";

export const DETECTOR_MODES = ["full", "incremental", "fix"] as const;
export type DetectorMode = (typeof DETECTOR_MODES)[number];

export const TIMES_OF_DAY = [
  "dawn",
  "morning",
  "day",
  "afternoon",
  "dusk",
  "evening",
  "night",
  "unspecified",
] as const;
export const CHARACTER_KINDS = [
  "human",
  "animal",
  "creature",
  "robot",
  "voice_only",
  "background_group",
] as const;
export type CharacterKind = (typeof CHARACTER_KINDS)[number];
export const CHARACTER_ROLES = ["lead", "supporting", "minor", "background"] as const;
export const ASSET_PRIORITIES = ["required", "optional"] as const;
export const PROP_CATEGORIES = [
  "hero_prop",
  "hand_prop",
  "functional_prop",
  "set_dressing",
  "prop_group",
] as const;
/** How a character's voice is heard (`voice_delivery`). */
export const VOICE_DELIVERIES = [
  "on_screen",
  "voice_over",
  "off_screen",
  "phone_or_device",
  "whisper",
  "singing",
  "other",
] as const;

/* ------------------------------------------------------------------------------------------ */
/* Output (submit_output_21)                                                                   */
/* ------------------------------------------------------------------------------------------ */

const evidence = z
  .string()
  .describe("Exact excerpt from the script, max 20 words, copied character for character.");

export const factSchema = z.object({
  field: z.string(),
  value: z.string(),
  status: z.enum(["stated", "implied"]),
  scene: z.string(),
  evidence,
});

export const lookSchema = z.object({
  look_id: z.string(),
  description: z.string(),
  scene_refs: z.array(z.string()),
  evidence: z.string(),
});

export const stateSchema = z.object({
  state_id: z.string(),
  description: z.string(),
  scene_refs: z.array(z.string()),
  evidence: z.string(),
});

export const sceneIndexEntrySchema = z.object({
  scene_number: z.string(),
  heading: z.string(),
  anchor: z.string().nullable(),
  location_id: z.string().nullable(),
  location_state_id: z.string().nullable(),
  time_of_day: z.enum(TIMES_OF_DAY),
  characters_present: z.array(z.string()),
  char_looks: z.array(z.object({ char_id: z.string(), look_id: z.string() })),
  heard_only: z.array(z.string()),
  speakers: z.array(z.string()),
  props_present: z.array(z.string()),
});

export const detectedCharacterSchema = z.object({
  char_id: z.string().regex(/^char_[0-9]+$/),
  name: z.string(),
  name_latin: z.string(),
  aliases: z.array(z.string()),
  kind: z.enum(CHARACTER_KINDS),
  role: z.enum(CHARACTER_ROLES),
  asset_priority: z.enum(ASSET_PRIORITIES),
  needs_visual: z.boolean(),
  is_minor: z.enum(["yes", "no", "unknown"]),
  same_person_as: z.string().nullable(),
  script_description: z.string(),
  facts: z.array(factSchema),
  looks: z.array(lookSchema),
  signature_prop_ids: z.array(z.string()),
  speaks: z.boolean(),
  dialogue_line_count: z.number().int().min(0),
  dialogue_language: z.string().nullable(),
  voice_delivery: z.array(z.enum(VOICE_DELIVERIES)),
  voice_hints: z.array(factSchema),
  relationships: z.array(z.object({ char_id: z.string(), relation: z.string() })),
  scene_refs: z.array(z.string()),
  first_scene: z.string(),
  ui_summary: z.string(),
});

export const detectedLocationSchema = z.object({
  loc_id: z.string().regex(/^loc_[0-9]+$/),
  name: z.string(),
  name_latin: z.string(),
  aliases: z.array(z.string()),
  location_group: z.string().nullable(),
  interior_exterior: z.enum(["interior", "exterior", "int_ext"]),
  time_of_day: z.enum(TIMES_OF_DAY),
  times_of_day: z.array(z.enum(TIMES_OF_DAY)),
  states: z.array(stateSchema),
  script_description: z.string(),
  facts: z.array(factSchema),
  fixed_elements_from_script: z.array(
    z.object({ element: z.string(), scene: z.string(), evidence: z.string() }),
  ),
  related_asset_ids: z.array(z.string()),
  asset_priority: z.enum(ASSET_PRIORITIES),
  scene_refs: z.array(z.string()),
  first_scene: z.string(),
  ui_summary: z.string(),
});

export const detectedPropSchema = z.object({
  prop_id: z.string().regex(/^prop_[0-9]+$/),
  name: z.string(),
  name_latin: z.string(),
  aliases: z.array(z.string()),
  category_hint: z.enum(PROP_CATEGORIES),
  subtype: z.string().nullable(),
  script_description: z.string(),
  facts: z.array(factSchema),
  states: z.array(stateSchema),
  text_on_object: z.array(z.object({ text: z.string(), evidence: z.string() })),
  users: z.array(z.string()),
  location_ids: z.array(z.string()),
  related_asset_ids: z.array(z.string()),
  asset_priority: z.enum(ASSET_PRIORITIES),
  scene_refs: z.array(z.string()),
  first_scene: z.string(),
  ui_summary: z.string(),
});

/** The owner's `submit_output_21` input schema. */
export const assetDetectorOutputSchema = z.object({
  output_version: z.literal("output_21"),
  mode: z.enum(DETECTOR_MODES),
  scene_index: z.array(sceneIndexEntrySchema),
  characters: z.array(detectedCharacterSchema),
  locations: z.array(detectedLocationSchema),
  props: z.array(detectedPropSchema),
  diff: z.object({
    added: z.array(z.string()),
    updated: z.array(z.string()),
    removed: z.array(z.string()),
  }),
  summary: z.object({
    scene_count: z.number().int().min(0),
    character_count: z.number().int().min(0),
    location_count: z.number().int().min(0),
    prop_count: z.number().int().min(0),
  }),
  applied_fixes: z.array(
    z.object({ code: z.string(), target_ids: z.array(z.string()), change: z.string() }),
  ),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});

/* ------------------------------------------------------------------------------------------ */
/* Input (the owner's section 2)                                                               */
/* ------------------------------------------------------------------------------------------ */

export const detectorSceneSchema = z.object({
  scene_number: z.string().trim().min(1).max(20),
  heading: z.string().max(500),
  text: z.string().max(200_000),
  purpose: z.string().max(2000).optional(),
  change: z.string().max(2000).optional(),
});

/**
 * An asset the project already has, as an output_21 entry with its temporary id and its
 * status. Only the entry's own fields are carried (whatever the type needs).
 */
export const knownAssetSchema = z.object({
  id: z.string().regex(/^(char|loc|prop)_[0-9]+$/),
  status: z.enum(["detected", "in_progress", "approved"]),
  /** The entry, as the detector wrote it (or as rebuilt from the stored asset). */
  entry: z.record(z.string(), z.unknown()),
});

export const detectorFixRequestSchema = z.object({
  type: z.enum(["technical", "preference"]),
  code: z.string().trim().min(1).max(20),
  instruction: z.string().trim().min(1).max(4000),
  target_ids: z.array(z.string()).max(50),
  custom_text: z.string().max(4000).optional(),
});

export const assetDetectorInputSchema = z
  .object({
    mode: z.enum(DETECTOR_MODES),
    project: z.object({
      format: z.enum(["movie", "series"]),
      episode_number: z.number().int().min(1).optional(),
      genre: z.string().max(500),
      style: z.string().max(500),
      era_setting: z.string().max(500).nullable(),
      ui_language: z.string().min(2).max(20),
      sector: z.enum(["wizard", "pro"]),
    }),
    script: z.object({
      title: z.string().max(500),
      logline: z.string().max(2000),
      source: z.enum(["generated", "uploaded"]),
      scenes: z.array(detectorSceneSchema).max(2000).optional(),
      raw_text: z.string().trim().min(1).max(600_000).optional(),
    }),
    known_assets: z.array(knownAssetSchema).max(1000).optional(),
    previous_output: assetDetectorOutputSchema.optional(),
    fix_requests: z.array(detectorFixRequestSchema).max(40).optional(),
    /**
     * BLAXZY-side, not part of the owner's input: the project's Creative Bible block for the
     * detector (`renderCreativeDna("asset_detector", bible).text`), like every other consumer. It
     * becomes a cached system block and is left out of the `<input>` JSON.
     */
    creativeDna: creativeDnaTextSchema.optional(),
  })
  .refine((i) => (i.script.scenes?.length ?? 0) > 0 || i.script.raw_text !== undefined, {
    message: "the script needs scenes or raw_text",
  })
  .refine((i) => i.mode !== "fix" || (i.previous_output && (i.fix_requests?.length ?? 0) > 0), {
    message: "fix mode needs previous_output and fix_requests",
  });

export type AssetDetectorInput = z.input<typeof assetDetectorInputSchema>;
export type AssetDetectorParsedInput = z.output<typeof assetDetectorInputSchema>;
export type AssetDetectorOutput = z.output<typeof assetDetectorOutputSchema>;
export type DetectorFact = z.output<typeof factSchema>;
export type DetectedCharacter = z.output<typeof detectedCharacterSchema>;
export type DetectedLocation = z.output<typeof detectedLocationSchema>;
export type DetectedProp = z.output<typeof detectedPropSchema>;
export type SceneIndexEntry = z.output<typeof sceneIndexEntrySchema>;
export type KnownAsset = z.output<typeof knownAssetSchema>;
export type DetectorFixRequest = z.output<typeof detectorFixRequestSchema>;
export type DetectorScene = z.output<typeof detectorSceneSchema>;
