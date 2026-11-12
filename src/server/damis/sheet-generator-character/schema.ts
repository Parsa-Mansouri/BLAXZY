/**
 * Character Sheet Generator v4 (the owner's `sheet_generator_character_v4.md`): one image prompt
 * for the 16:9 character sheet (face, headless front and back full-body figures, six numbered
 * detail frames) on a neutral grey studio, built from the approved board. The output mirrors the
 * owner's OUTPUT FORMAT field for field; the input is BLAXZY's camelCase, sent to the model as the
 * owner's JSON (see `prompt.ts`).
 */
import { z } from "zod";
import {
  designerFixRequestSchema,
  designerProjectSchema,
  MAX_DESIGN_TEXT,
} from "../shared/designer";

/** approved (always image 1), previous_sheet (correction rounds), then the user's own photos. */
export const CHARACTER_SHEET_REFERENCE_ROLES = [
  "approved",
  "previous_sheet",
  "face",
  "outfit",
  "full_body",
  "other",
] as const;
export type CharacterSheetReferenceRole = (typeof CHARACTER_SHEET_REFERENCE_ROLES)[number];

/** The approved board, the previous sheet and at most four original photos. */
export const MAX_SHEET_REFERENCES = 6;

export const detailCellSchema = z.object({
  slot: z.number().int().min(1).max(6),
  subject: z.string().describe("Short description of what this frame shows."),
  reason: z.string().describe("Why it was chosen."),
});
export type DetailCell = z.output<typeof detailCellSchema>;

export const characterSheetInputSchema = z.object({
  project: designerProjectSchema,
  character: z.object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(200).optional(),
    /** The details the user gave (guided answers, description), by field. */
    details: z.record(z.string().min(1).max(64), z.string().trim().min(1).max(1000)).default({}),
    isMinor: z.boolean().optional(),
  }),
  /** In attachment order; the approved board is always first. */
  referenceImages: z
    .array(
      z.object({
        fileId: z.uuid(),
        role: z.enum(CHARACTER_SHEET_REFERENCE_ROLES),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .min(1)
    .max(MAX_SHEET_REFERENCES),
  boardPrompt: z.string().trim().min(1).max(20_000).optional(),
  boardAssumptions: z.array(z.string().trim().min(1).max(1000)).max(60).default([]),
  renderCellNumbers: z.boolean().default(true),
  userNotes: z.string().trim().min(1).max(MAX_DESIGN_TEXT).optional(),
  /** Fix mode: the rejected sheet's prompt and frames. */
  previousPrompt: z.string().trim().min(1).max(20_000).optional(),
  previousDetailCells: z.array(detailCellSchema).max(6).optional(),
  fixRequests: z.array(designerFixRequestSchema).max(40).default([]),
});
export type CharacterSheetInput = z.input<typeof characterSheetInputSchema>;
export type CharacterSheetParsedInput = z.output<typeof characterSheetInputSchema>;

export const characterSheetOutputSchema = z.object({
  character_name: z.string(),
  asset_type: z.enum(["character"]),
  image_prompt: z.string().describe("The full final prompt for Nano Banana."),
  aspect_ratio: z.enum(["16:9"]),
  style_used: z.string().describe("Concise descriptor of the style read from the approved image."),
  edit_mode: z.enum(["full", "edit_previous_sheet"]),
  reference_order: z.array(
    z.object({ index: z.number().int(), role: z.enum(CHARACTER_SHEET_REFERENCE_ROLES) }),
  ),
  detail_cells: z.array(detailCellSchema).describe("Exactly six entries, slots 1 to 6, in order."),
  applied_fixes: z.array(z.object({ code: z.string(), change: z.string() })),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type CharacterSheetOutput = z.output<typeof characterSheetOutputSchema>;

/** The warning a sheet dami returns for a change it may not make (routes back to the designer). */
export const DESIGN_CHANGE_PREFIX = "DESIGN_CHANGE_REQUESTED:";

export function designChangeRequests(warnings: readonly string[]): string[] {
  return warnings
    .filter((w) => w.trim().startsWith(DESIGN_CHANGE_PREFIX))
    .map((w) => w.trim().slice(DESIGN_CHANGE_PREFIX.length).trim());
}
