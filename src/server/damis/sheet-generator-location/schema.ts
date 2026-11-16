/**
 * Location Sheet Generator v1 (the owner's `sheet_generator_location_v1.md`): the prompts for the
 * remaining views of a location's pack (lock mode, one image per view) or for the four-panel
 * concept sheet (concept mode, Pro), from the locked spec and the approved Hero. The output
 * mirrors the owner's `submit_location_views` tool schema field for field (sent as structured JSON
 * output); the input is BLAXZY's camelCase, sent as the owner's `<input>` JSON (see `prompt.ts`).
 */
import { creativeDnaTextSchema } from "../shared/creative-dna-input";
import { z } from "zod";
import { designerProjectSchema, MAX_DESIGN_TEXT, MAX_SHEET_VIEWS } from "../shared/designer";

/** A view of the pack, by view id (`hero_wide`, `reverse_wide`, `detail_1` ...). */
const viewId = z.string().trim().min(1).max(60);

export const locationSheetFixRequestSchema = z.object({
  code: z.string().trim().min(1).max(40),
  instruction: z.string().trim().min(1).max(MAX_DESIGN_TEXT),
  note: z.string().trim().min(1).max(MAX_DESIGN_TEXT).optional(),
  viewId,
  editEligible: z.boolean(),
});
export type LocationSheetFixRequest = z.output<typeof locationSheetFixRequestSchema>;

export const locationSheetInputSchema = z.object({
  /** The project's Creative Bible block for this dami (`renderCreativeDna`); absent: no bible. */
  creativeDna: creativeDnaTextSchema.optional(),
  project: designerProjectSchema,
  /** The Location Generator's approved answer (spec fields, DNA, layout, coverage plan, style). */
  lockedSpec: z.record(z.string(), z.unknown()),
  mode: z.enum(["concept", "lock"]).default("lock"),
  /** The approved images attached in this order; the Hero is always first. */
  approvedImages: z
    .array(z.object({ fileId: z.uuid(), viewId }))
    .min(1)
    .max(8),
  onlyViews: z.array(viewId).max(20).optional(),
  excludeAssets: z.array(z.string().trim().min(1).max(200)).max(400).default([]),
  userNotes: z.string().trim().min(1).max(MAX_DESIGN_TEXT).optional(),
  /** Fix mode: the previous answer, with every view's prompt. */
  previousOutput: z.record(z.string(), z.unknown()).optional(),
  fixRequests: z.array(locationSheetFixRequestSchema).max(40).default([]),
});
export type LocationSheetInput = z.input<typeof locationSheetInputSchema>;
export type LocationSheetParsedInput = z.output<typeof locationSheetInputSchema>;

const referenceOrderSchema = z.array(
  z.object({ index: z.number().int(), source_view_id: z.string() }),
);

export const locationSheetViewSchema = z.object({
  view_id: z.string(),
  name: z.string(),
  image_prompt: z.string(),
  aspect_ratio: z.enum(["16:9"]),
  reference_order: referenceOrderSchema,
  depends_on: z.array(z.string()),
  must_show: z.array(
    z.object({
      anchor_id: z.string(),
      expected_position: z
        .string()
        .describe("As seen in THIS view, e.g. 'far right, on the right wall'."),
    }),
  ),
  must_not_show: z.array(z.string()),
  new_hypotheses: z
    .array(z.string())
    .describe(
      "Anything in this view not already fixed by the spec (proposed design, needs approval).",
    ),
  review_focus: z
    .array(z.string())
    .describe("Short checks the reviewer should make for this view."),
  edit_mode: z
    .enum(["full", "edit_previous_view"])
    .describe(
      "edit_previous_view: the backend attaches the previous version as a reference and the prompt is an edit instruction.",
    ),
});
export type LocationSheetView = z.output<typeof locationSheetViewSchema>;

export const locationSheetOutputSchema = z.object({
  asset_id: z.string(),
  location_name: z.string(),
  mode: z.enum(["concept", "lock"]),
  concept_sheet: z
    .object({
      image_prompt: z.string(),
      aspect_ratio: z.enum(["16:9"]),
      reference_order: referenceOrderSchema,
      panel_plan: z
        .array(
          z.object({
            panel: z.enum(["hero", "alternate", "detail_1", "detail_2"]),
            content: z.string(),
          }),
        )
        .describe("Exactly 4: hero, alternate, detail_1, detail_2."),
      edit_mode: z.enum(["full", "edit_previous_view"]),
    })
    .nullable()
    .describe("Concept mode only; null in lock mode."),
  views: z
    .array(locationSheetViewSchema)
    .max(MAX_SHEET_VIEWS)
    .describe(
      "Lock mode only; empty in concept mode. Excludes the Hero, which is already approved.",
    ),
  generation_order: z
    .array(z.string())
    .describe("view_ids in the order the backend must generate them."),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  applied_fixes: z.array(z.string()),
});
export type LocationSheetOutput = z.output<typeof locationSheetOutputSchema>;
