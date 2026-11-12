/**
 * Prop Sheet Generator v1 (the owner's `sheet_generator_prop_v1.md`): the prompts for the
 * remaining views of a prop's Adaptive Asset Sheet (one image per view, on the grey studio), from
 * the locked spec and the approved Hero (`hero_34`). The output mirrors the owner's
 * `submit_asset_views` tool schema field for field (sent as structured JSON output); the input is
 * BLAXZY's camelCase, sent as the owner's JSON template (see `prompt.ts`).
 */
import { z } from "zod";
import { designerProjectSchema, MAX_DESIGN_TEXT } from "../shared/designer";
import { PROP_ASPECT_RATIOS, PROP_SHEET_LEVELS } from "../prop-generator/schema";

const viewId = z.string().trim().min(1).max(60);

export const PROP_REVIEW_FOCUS = [
  "shape",
  "scale",
  "material",
  "directional",
  "functional",
  "reference_fidelity",
] as const;

export const propSheetFixRequestSchema = z.object({
  code: z.string().trim().min(1).max(40),
  instruction: z.string().trim().min(1).max(MAX_DESIGN_TEXT),
  note: z.string().trim().min(1).max(MAX_DESIGN_TEXT).optional(),
  viewId,
  editEligible: z.boolean(),
});
export type PropSheetFixRequest = z.output<typeof propSheetFixRequestSchema>;

export const propSheetInputSchema = z.object({
  /** The Prop Generator's approved answer (classification, DNA, links, sheet plan, style). */
  lockedSpec: z.record(z.string(), z.unknown()),
  /** The approved images attached in this order; `hero_34` is always first. */
  approvedImages: z
    .array(z.object({ fileId: z.uuid(), viewId }))
    .min(1)
    .max(8),
  /** The user's original photos, attached after the approved images. */
  userReferenceImages: z
    .array(
      z.object({
        fileId: z.uuid(),
        role: z.string().trim().min(1).max(40),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .max(4)
    .default([]),
  linkedCharacters: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        ageGroup: z.string().trim().max(200).default("unknown"),
        build: z.string().trim().max(200).default("unknown"),
        handedness: z.string().trim().max(40).default("unknown"),
      }),
    )
    .max(20)
    .default([]),
  project: designerProjectSchema,
  sheetLevelOverride: z.enum(PROP_SHEET_LEVELS).optional(),
  /** Fix mode: the previous answer, with every view's prompt. */
  previousOutput: z.record(z.string(), z.unknown()).optional(),
  fixRequests: z.array(propSheetFixRequestSchema).max(40).default([]),
  userNotes: z.string().trim().min(1).max(MAX_DESIGN_TEXT).optional(),
});
export type PropSheetInput = z.input<typeof propSheetInputSchema>;
export type PropSheetParsedInput = z.output<typeof propSheetInputSchema>;

export const propSheetViewSchema = z.object({
  view_id: z.string(),
  label: z.string().describe("From the VIEW_LIBRARY, drawn on the sheet by the backend."),
  purpose: z.string(),
  state_id: z.string(),
  image_prompt: z.string(),
  aspect_ratio: z.enum(PROP_ASPECT_RATIOS),
  reference_order: z.array(
    z.object({
      index: z.number().int(),
      source: z
        .string()
        .describe(
          "approved_hero | approved_view:<view_id> | previous:<view_id> | user_reference:<n>",
        ),
      role: z.string(),
    }),
  ),
  depends_on: z.array(z.string()),
  must_show: z
    .array(z.string())
    .describe("Concrete checks, with viewer's left/right for asymmetric details."),
  must_not_show: z.array(z.string()),
  new_hypotheses: z
    .array(z.object({ area: z.string(), proposal: z.string() }))
    .describe(
      "Parts this view reveals that neither the Hero nor the DNA defines. Proposed, need approval.",
    ),
  review_focus: z.array(z.enum(PROP_REVIEW_FOCUS)),
  edit_mode: z.enum(["full", "edit_previous_view"]),
});
export type PropSheetView = z.output<typeof propSheetViewSchema>;

export const propScaleCardSchema = z.object({
  dimensions_cm: z.object({ height: z.number(), width: z.number(), depth: z.number() }).nullable(),
  dimensions_status: z.enum(["confirmed", "inferred", "unknown"]),
  relative_reference: z.string(),
  text: z
    .string()
    .describe(
      "One line for the card. Numbers only if dimensions_status is confirmed; otherwise relative wording.",
    ),
});
export type PropScaleCard = z.output<typeof propScaleCardSchema>;

export const propSheetOutputSchema = z.object({
  asset_id: z.string(),
  asset_name: z.string(),
  sheet_level: z.enum(PROP_SHEET_LEVELS),
  views: z.array(propSheetViewSchema).describe("At most 13 views."),
  generation_order: z.array(z.string()),
  scale_card: propScaleCardSchema.describe(
    "Data for the backend-drawn scale card. Never drawn by the image model.",
  ),
  applied_fixes: z.array(z.object({ code: z.string(), view_id: z.string(), change: z.string() })),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type PropSheetOutput = z.output<typeof propSheetOutputSchema>;
