/**
 * Prop Generator v1 (the owner's `prop_generator_dami_v1.md`): one prop's Asset Specification,
 * DNA, project links, sheet plan and Hero Design prompt (hero_34 on the grey studio). The output
 * mirrors the owner's `submit_asset_spec` tool schema field for field (sent as structured JSON
 * output); the input is BLAXZY's camelCase, sent as the owner's JSON template (see `prompt.ts`).
 * Characters and locations are named by their real names, never by detector ids.
 */
import { z } from "zod";
import {
  designerFixRequestSchema,
  designerProjectSchema,
  designerScriptSchema,
  MAX_DESIGN_REFERENCES,
  MAX_DESIGN_TEXT,
  referenceSchema,
} from "../shared/designer";

export const PROP_REFERENCE_ROLES = ["identity", "material", "detail", "mood", "other"] as const;
export type PropReferenceRole = (typeof PROP_REFERENCE_ROLES)[number];

export const PROP_ADVANCED_FIELDS = [
  "materials",
  "colors",
  "period_style",
  "wear",
  "asymmetric_details",
  "detachable_parts",
  "mechanics",
  "hand_interaction",
  "production_limits",
  "forbidden",
] as const;
export type PropAdvancedField = (typeof PROP_ADVANCED_FIELDS)[number];

const answer = z.string().trim().min(1).max(1000);

export const propGuidedAnswersSchema = z.object({
  what_is_it: answer.optional(),
  importance: answer.optional(),
  usage: answer.optional(),
  scale: answer.optional(),
  must_keep: answer.optional(),
  advanced: z.partialRecord(z.enum(PROP_ADVANCED_FIELDS), answer).optional(),
});
export type PropGuidedAnswers = z.output<typeof propGuidedAnswersSchema>;

export const propGeneratorInputSchema = z.object({
  asset: z.object({
    name: z.string().trim().min(1).max(120),
    /** The detector's category (hero_prop, hand_prop, functional_prop, set_dressing, prop_group). */
    categoryHint: z.string().trim().min(1).max(40).optional(),
    scriptDescription: z.string().trim().max(MAX_DESIGN_TEXT).default(""),
    sceneRefs: z.array(z.string().trim().min(1).max(20)).max(200).default([]),
  }),
  project: designerProjectSchema,
  styleOverride: z.string().trim().min(1).max(400).optional(),
  userPrompt: z.string().trim().min(1).max(MAX_DESIGN_TEXT).optional(),
  guidedAnswers: propGuidedAnswersSchema.optional(),
  referenceImages: z
    .array(referenceSchema(PROP_REFERENCE_ROLES))
    .max(MAX_DESIGN_REFERENCES)
    .default([]),
  scriptContext: designerScriptSchema.optional(),
  linkedCharacters: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        ageGroup: z.string().trim().max(200).default("unknown"),
        build: z.string().trim().max(200).default("unknown"),
        handedness: z.string().trim().max(40).default("unknown"),
        usageNote: z.string().trim().max(500).default(""),
      }),
    )
    .max(20)
    .default([]),
  linkedLocations: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        summary: z.string().trim().max(1000).default(""),
        /** The approved location's fixed anchor this prop already is, else null. */
        anchor: z.string().trim().max(500).nullable().default(null),
        /** The approved location Hero, attached after the user's references. */
        heroFileId: z.uuid().nullable().default(null),
      }),
    )
    .max(10)
    .default([]),
  clarifyAnswers: z.record(z.string().min(1).max(64), answer).optional(),
  /** Fix mode: the rejected answer (with its Hero prompt). */
  previousOutput: z.record(z.string(), z.unknown()).optional(),
  fixRequests: z.array(designerFixRequestSchema).max(40).default([]),
  userNotes: z.string().trim().min(1).max(MAX_DESIGN_TEXT).optional(),
  /** Wizard (one blocking question at most) or Pro (three). */
  sector: z.enum(["wizard", "pro"]).default("wizard"),
});
export type PropGeneratorInput = z.input<typeof propGeneratorInputSchema>;
export type PropGeneratorParsedInput = z.output<typeof propGeneratorInputSchema>;

const FACES = ["F", "B", "L", "R", "T", "U", "whole", "inside"] as const;
const DETAIL_FACES = ["F", "B", "L", "R", "T", "U", "inside"] as const;
export const PROP_ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;
export const PROP_SHEET_LEVELS = ["simple", "standard", "production"] as const;

export const propGeneratorOutputSchema = z.object({
  asset_id: z.string().describe("Echo of asset.asset_id."),
  asset_name: z.string(),
  source_mode: z.enum(["prompt_only", "reference_only", "prompt_reference", "auto"]),
  script_analysis: z
    .object({
      role_in_story: z.string(),
      actions_on_object: z.array(z.string()).describe("What characters do with it, per scene."),
      required_features: z.array(z.string()).describe("Physical facts the script makes necessary."),
      required_states: z.array(z.string()),
      dramatic_weight: z
        .string()
        .describe("What the object must make the audience feel or notice."),
    })
    .describe("Filled first. Empty strings and arrays when there is no script_context."),
  classification: z.object({
    families: z.array(z.enum(["hero_prop", "hand_prop", "set_dressing", "functional_prop"])),
    importance: z.enum(["background", "standard", "hero"]),
    interaction: z.enum(["static", "carried", "multi_state"]),
    complexity: z.enum(["low", "medium", "high"]),
  }),
  spec_fields: z
    .array(
      z.object({
        field: z.string(),
        value: z.string(),
        status: z.enum(["confirmed", "inferred", "unknown"]),
        source: z.enum([
          "user",
          "guided_answer",
          "reference",
          "location",
          "character",
          "script",
          "project",
          "dami",
        ]),
        critical: z
          .boolean()
          .describe("True if a wrong value would break identity, scale or function."),
      }),
    )
    .describe(
      "One entry per specification field (what_is_it, silhouette, proportions, scale, materials, colors, finish, wear, era_style, signature_details, states, mechanics, must_keep, must_not, front_definition, and any other that matters).",
    ),
  clarifying_questions: z.array(
    z.object({
      id: z.string(),
      field: z.string(),
      question: z.string().describe("In project.ui_language."),
      options: z.array(z.string()),
      default: z.string().describe("The value used if the user skips. Must be one of options."),
      blocking: z.boolean(),
    }),
  ),
  dna: z.object({
    object_type: z.string(),
    front_definition: z.string(),
    geometry: z.object({
      silhouette: z.string(),
      proportions: z.string().describe("Height : width : depth as a ratio, plus a sentence."),
      rest_orientation: z.string().describe("How it normally rests or is held; what is up."),
      parts: z.array(
        z.object({
          part_id: z.string(),
          name: z.string(),
          attaches_to: z.string(),
          face: z.enum(FACES),
          description: z.string(),
        }),
      ),
    }),
    scale: z.object({
      size_class: z.enum(["tiny", "hand_held", "small", "medium", "large", "very_large"]),
      dimensions_cm: z
        .object({ height: z.number(), width: z.number(), depth: z.number() })
        .nullable(),
      dimensions_status: z.enum(["confirmed", "inferred", "unknown"]),
      relative_reference: z
        .string()
        .describe("Size compared with a hand, a person or a known object."),
      scale_reference_type: z.enum(["hand", "human_figure", "standard_object"]),
    }),
    materials: z.array(
      z.object({
        part_id: z.string(),
        material: z.string(),
        finish: z.string(),
        color: z.string(),
        wear: z.string(),
      }),
    ),
    palette: z.array(z.string()),
    signature_details: z.array(
      z.object({
        detail_id: z.string(),
        description: z.string(),
        face: z.enum(DETAIL_FACES),
        position: z.string().describe("As seen looking straight at that face."),
        asymmetric: z.boolean(),
        is_text: z.boolean(),
        text_content: z.string().nullable(),
        render_as: z.enum(["as_designed", "legible_text", "non_legible_marks"]),
      }),
    ),
    states: z.array(
      z.object({
        state_id: z.string(),
        name: z.string(),
        description: z.string(),
        is_default: z.boolean(),
      }),
    ),
    mechanics: z.array(
      z.object({
        mechanism_id: z.string(),
        type: z.string(),
        part_id: z.string(),
        how: z.string().describe("Axis, hinge side, direction and range, physically plausible."),
      }),
    ),
    must_keep: z.array(z.string()),
    must_not: z.array(z.string()),
    mutable: z
      .array(z.string())
      .describe("What may vary between shots (dust, contents, light state) without a new version."),
  }),
  project_links: z.object({
    scene_refs: z.array(z.string()),
    character_links: z.array(
      z.object({
        character_id: z.string(),
        usage: z.string(),
        hand: z.enum(["left", "right", "both", "unknown"]),
      }),
    ),
    location_links: z.array(
      z.object({
        location_id: z.string(),
        anchor_id: z.string().nullable(),
        placement_hint: z
          .string()
          .describe(
            "Where in the space, in the location's compass terms (wall side, position_pct, near which anchor).",
          ),
        facing: z
          .string()
          .describe(
            "Which way the asset's FRONT faces in the location (N, E, S, W or toward an anchor).",
          ),
      }),
    ),
  }),
  sheet_plan: z.object({
    level: z.enum(PROP_SHEET_LEVELS),
    level_reason: z.string(),
    views: z
      .array(z.object({ view_id: z.string(), purpose: z.string() }))
      .describe("Planned views AFTER the hero, from the VIEW_LIBRARY."),
  }),
  hero_view: z
    .object({
      view_id: z.enum(["hero_34"]),
      hero_source: z.enum(["generate", "from_reference", "from_location"]),
      state_id: z.string(),
      image_prompt: z.string(),
      aspect_ratio: z.enum(PROP_ASPECT_RATIOS),
      reference_order: z.array(
        z.object({
          index: z.number().int(),
          source: z.string().describe("user_reference:<n> or location_hero:<location_id>"),
          role: z.string(),
        }),
      ),
      must_show: z.array(z.string()),
      must_not_show: z.array(z.string()),
    })
    .nullable()
    .describe("Null only when a blocking clarifying question exists."),
  changes_identity: z
    .boolean()
    .describe(
      "Fix mode only: true if this round changed silhouette, materials, colors, signature details, states or scale. Always false on first generation.",
    ),
  style_used: z.string(),
  style_source: z.enum(["style_override", "project_style"]),
  applied_fixes: z.array(z.object({ code: z.string(), change: z.string() })),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type PropGeneratorOutput = z.output<typeof propGeneratorOutputSchema>;
