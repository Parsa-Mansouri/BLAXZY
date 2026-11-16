/**
 * Character Generator v5 (the owner's `character_generator_dami_v5.md`): one image prompt for a
 * 16:9 character reference board shown in the project's world. The output mirrors the owner's
 * OUTPUT FORMAT field for field; the input is BLAXZY's camelCase, sent to the model as the
 * owner's JSON (see `prompt.ts`).
 */
import { creativeDnaTextSchema } from "../shared/creative-dna-input";
import { z } from "zod";
import {
  designerFixRequestSchema,
  designerProjectSchema,
  MAX_DESIGN_REFERENCES,
  MAX_DESIGN_TEXT,
  referenceSchema,
} from "../shared/designer";

export const CHARACTER_REFERENCE_ROLES = ["face", "outfit", "full_body", "other"] as const;
export type CharacterReferenceRole = (typeof CHARACTER_REFERENCE_ROLES)[number];

/** The character details the owner lists (any may be missing). */
export const CHARACTER_DETAIL_FIELDS = [
  "age",
  "gender",
  "skin_tone",
  "face",
  "hair",
  "body",
  "outfit",
  "accessories",
  "personality",
  "marks",
] as const;
export type CharacterDetailField = (typeof CHARACTER_DETAIL_FIELDS)[number];

const detail = z.string().trim().min(1).max(1000);

export const characterGeneratorInputSchema = z.object({
  /** The project's Creative Bible block for this dami (`renderCreativeDna`); absent: no bible. */
  creativeDna: creativeDnaTextSchema.optional(),
  project: designerProjectSchema,
  /** Pro only: a style for this character instead of the project's. The Wizard never sends it. */
  styleOverride: z.string().trim().min(1).max(400).optional(),
  /** Where the character is shown; derived from the project when missing. */
  environment: z.string().trim().min(1).max(1000).optional(),
  character: z.object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(200).optional(),
    /** What the script says about the character. */
    description: z.string().trim().max(MAX_DESIGN_TEXT).optional(),
    /** Human, animal, creature or robot (from the detector). */
    kind: z.string().trim().min(1).max(40).optional(),
    details: z.partialRecord(z.enum(CHARACTER_DETAIL_FIELDS), detail).default({}),
    /** Facts the script states, as "field: value". */
    facts: z.array(z.string().trim().min(1).max(400)).max(40).default([]),
    isMinor: z.boolean().optional(),
  }),
  referenceImages: z
    .array(referenceSchema(CHARACTER_REFERENCE_ROLES))
    .max(MAX_DESIGN_REFERENCES)
    .default([]),
  userNotes: z.string().trim().min(1).max(MAX_DESIGN_TEXT).optional(),
  /** Fix mode: the prompt of the rejected board. */
  previousPrompt: z.string().trim().min(1).max(20_000).optional(),
  fixRequests: z.array(designerFixRequestSchema).max(40).default([]),
});
export type CharacterGeneratorInput = z.input<typeof characterGeneratorInputSchema>;
export type CharacterGeneratorParsedInput = z.output<typeof characterGeneratorInputSchema>;

export const characterGeneratorOutputSchema = z.object({
  character_name: z.string(),
  mode: z.enum(["text_only", "reference"]),
  image_prompt: z.string().describe("The full final prompt for Nano Banana."),
  aspect_ratio: z.enum(["16:9"]),
  environment_used: z.string().describe("Short description of the environment shown."),
  style_used: z.string().describe("Concise descriptor of the effective style rendered in."),
  style_source: z.enum(["project", "override"]),
  reference_order: z.array(
    z.object({ index: z.number().int(), role: z.enum(CHARACTER_REFERENCE_ROLES) }),
  ),
  applied_fixes: z.array(z.object({ code: z.string(), change: z.string() })),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type CharacterGeneratorOutput = z.output<typeof characterGeneratorOutputSchema>;
