/**
 * Location Generator v1 (the owner's `location_generator_dami_v1.md`): a location's
 * specification, DNA, layout, coverage plan and Hero prompt. The output mirrors the owner's
 * `submit_location_spec` tool schema field for field (sent as structured JSON output); the input
 * is BLAXZY's camelCase, sent as the owner's `<input>` JSON (see `prompt.ts`).
 */
import { z } from "zod";
import {
  designerFixRequestSchema,
  designerProjectSchema,
  designerScriptSchema,
  guidedAnswersSchema,
  MAX_DESIGN_REFERENCES,
  MAX_DESIGN_TEXT,
  referenceSchema,
} from "../shared/designer";

export const LOCATION_REFERENCE_ROLES = ["hero", "layout", "mood", "detail", "other"] as const;
export type LocationReferenceRole = (typeof LOCATION_REFERENCE_ROLES)[number];

export const LOCATION_SOURCE_MODES = [
  "auto",
  "prompt_only",
  "prompt_reference",
  "reference_only",
] as const;

export const locationGeneratorInputSchema = z.object({
  project: designerProjectSchema,
  location: z.object({
    name: z.string().trim().min(1).max(120),
    interiorExterior: z.enum(["interior", "exterior", "int_ext"]).optional(),
    timeOfDay: z.string().trim().min(1).max(40).optional(),
    scriptDescription: z.string().trim().max(MAX_DESIGN_TEXT).default(""),
    sceneRefs: z.array(z.string().trim().min(1).max(20)).max(200).default([]),
  }),
  scriptContext: designerScriptSchema.optional(),
  userPrompt: z.string().trim().min(1).max(MAX_DESIGN_TEXT).optional(),
  guidedAnswers: guidedAnswersSchema.optional(),
  referenceImages: z
    .array(referenceSchema(LOCATION_REFERENCE_ROLES))
    .max(MAX_DESIGN_REFERENCES)
    .default([]),
  /** Wizard: always `lock`. */
  outputMode: z.enum(["concept", "lock"]).default("lock"),
  styleOverride: z.string().trim().min(1).max(400).optional(),
  /** Names of the project's characters and props (separate assets, never drawn here). */
  excludeAssets: z.array(z.string().trim().min(1).max(200)).max(400).default([]),
  userNotes: z.string().trim().min(1).max(MAX_DESIGN_TEXT).optional(),
  /** Fix mode: the rejected answer (with its Hero prompt). */
  previousOutput: z.record(z.string(), z.unknown()).optional(),
  fixRequests: z.array(designerFixRequestSchema).max(40).default([]),
});
export type LocationGeneratorInput = z.input<typeof locationGeneratorInputSchema>;
export type LocationGeneratorParsedInput = z.output<typeof locationGeneratorInputSchema>;

const status2 = z.enum(["confirmed", "inferred"]);

export const locationSpecFieldSchema = z.object({
  group: z.enum(["Identity", "Spatial", "Visual", "Environment", "Continuity"]),
  field: z.string(),
  value: z.string(),
  status: z.enum(["confirmed", "inferred", "unknown"]),
  source: z.enum(["user", "reference", "script", "genre_style", "design"]),
  critical: z.boolean(),
});

export const locationGeneratorOutputSchema = z.object({
  asset_id: z.string(),
  location_name: z.string(),
  source_mode: z.enum(LOCATION_SOURCE_MODES),
  narrative_analysis: z.object({
    dramatic_core: z.string().describe("1 to 2 sentences. Empty string if no script slice."),
    location_role: z.string(),
    events: z.array(
      z.object({
        scene_number: z.number().int(),
        what_happens: z.string(),
        characters_present: z.number().int(),
      }),
    ),
    spatial_demands: z.array(z.object({ demand: z.string(), serves: z.string() })),
    movement_paths: z.array(z.string()),
    emotional_arc: z.string(),
    mood_target: z.string(),
  }),
  spec_fields: z
    .array(locationSpecFieldSchema)
    .describe("One entry per field. Groups: Identity, Spatial, Visual, Environment, Continuity."),
  dna: z.object({
    geometry: z.string(),
    fixed_anchors: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        where: z.string().describe("Wall or zone plus position, using the orientation system."),
        status: status2,
      }),
    ),
    visual_identity: z.object({
      era: z.string(),
      architectural_style: z.string(),
      materials: z.array(z.string()),
      base_palette: z.array(z.string()),
      wear_level: z.string(),
      scale: z.string(),
    }),
    continuity_constraints: z
      .array(z.string())
      .describe("Includes negative constraints such as 'no additional doors or windows'."),
    mutable_elements: z
      .array(z.string())
      .describe("Time of day, light intensity, weather, movable objects."),
  }),
  layout: z.object({
    space_kind: z.enum(["interior", "exterior"]),
    shape: z.string(),
    approx_size: z.object({ width_m: z.number(), depth_m: z.number(), height_m: z.number() }),
    zones: z.array(z.object({ id: z.string(), name: z.string(), area: z.string() })),
    openings: z.array(
      z.object({
        id: z.string(),
        type: z.enum(["door", "window", "arch", "stairs", "gate", "other"]),
        side: z.enum(["N", "E", "S", "W", "ceiling", "floor"]),
        position_pct: z.number(),
        size: z.string(),
        state: z.string(),
        status: status2,
      }),
    ),
    key_objects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        side_or_zone: z.string(),
        position_pct: z.number().nullable(),
        size: z.string(),
        fixed: z.boolean(),
        status: status2,
      }),
    ),
    cameras: z.array(
      z.object({
        id: z.string(),
        view: z.string(),
        stands_at: z.string(),
        looks_toward: z.string(),
      }),
    ),
    paths: z.array(z.object({ from: z.string(), to: z.string(), note: z.string() })),
  }),
  coverage_plan: z.object({
    mode: z.enum(["concept", "lock"]),
    views: z.array(
      z.object({
        view_id: z.string(),
        name: z.string(),
        camera_id: z.string(),
        purpose: z.string(),
        required: z.boolean(),
      }),
    ),
  }),
  hero_wide: z.object({
    mode: z.enum(["generate", "use_uploaded", "restyle_uploaded"]),
    image_prompt: z.string().describe("Empty string when mode is use_uploaded."),
    aspect_ratio: z.enum(["16:9"]),
    reference_order: z.array(
      z.object({ index: z.number().int(), role: z.enum(LOCATION_REFERENCE_ROLES) }),
    ),
    visible_anchor_ids: z.array(z.string()),
    hidden_anchor_ids: z.array(z.string()),
  }),
  location_summary: z.string().describe("Canonical descriptor, max 40 words."),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  style_used: z
    .string()
    .describe(
      "The effective style actually used, specific variant if the input style was generic.",
    ),
  style_source: z.enum(["style_override", "project_style"]),
  applied_fixes: z
    .array(z.string())
    .describe("Codes of the fix_requests applied this round. Empty on first generation."),
});
export type LocationGeneratorOutput = z.output<typeof locationGeneratorOutputSchema>;
