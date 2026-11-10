import { z } from "zod";
import { ASSET_KINDS } from "@/server/db/schema";
import { projectStyleSchema } from "../shared/style";

export const ASSET_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const assetSlugSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(ASSET_SLUG_PATTERN, "slug must be lower-case ASCII words joined by single hyphens");

/** An asset already stored for the project (re-detection after a script edit). */
export const knownAssetSchema = z.object({
  kind: z.enum(ASSET_KINDS),
  name: z.string().trim().min(1).max(200),
  slug: assetSlugSchema,
  description: z.string().max(4000).nullish(),
});

export const assetDetectorInputSchema = z.object({
  style: projectStyleSchema,
  content: z.string().trim().min(1).max(600_000),
  knownAssets: z.array(knownAssetSchema).max(500).optional(),
});

export const detectedAssetSchema = z.object({
  kind: z.enum(ASSET_KINDS),
  name: z.string().trim().min(1).max(200).describe("Display name, as the script names it."),
  slug: assetSlugSchema.describe("Stable lower-case key, unique within its kind."),
  description: z
    .string()
    .trim()
    .min(1)
    .max(1500)
    .describe("Every visual (or, for voices, audible) fact the script states, in English."),
  appearsIn: z
    .array(z.string().trim().min(1).max(300))
    .min(1)
    .describe("Scene headings where the asset appears, copied from the script."),
});

export const assetDetectorOutputSchema = z.object({
  assets: z.array(detectedAssetSchema).max(400),
});

export type KnownAsset = z.output<typeof knownAssetSchema>;
export type DetectedAsset = z.output<typeof detectedAssetSchema>;
export type AssetDetectorInput = z.input<typeof assetDetectorInputSchema>;
export type AssetDetectorOutput = z.output<typeof assetDetectorOutputSchema>;
