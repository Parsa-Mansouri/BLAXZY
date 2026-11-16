/**
 * What a Director run is made of, and the pure rules around it: the frozen input every batch of a
 * run shares (`DirectionContext`), the asset registry built from the stored detection, how many
 * blocks a script will need (full call or plan and batches) and the batch ranges. No database.
 */
import { z } from "zod";
import {
  assetRegistrySchema,
  BLOCK_MODES,
  creativeBibleShape,
  platformConfigSchema,
  WORDS_PER_MINUTE,
  type BlockMode,
  type CreativeBible,
} from "@/server/damis";
import { ASSET_KINDS, type AssetKind, type ProjectStyle } from "@/server/db/schema";
import type { DetectorView } from "@/server/assets";

/** Up to this many blocks the Director answers in one `full` call (the owner's threshold). */
export const FULL_MODE_MAX_BLOCKS = 8;

/** Blocks per `write_blocks` batch. */
export const BATCH_BLOCKS = 8;

export const directionBindingSchema = z.object({
  /** The Director's id (`char_1`, `loc_2`, `prop_3`). */
  id: z.string(),
  kind: z.enum(ASSET_KINDS),
  name: z.string(),
  /** False for an asset that is only a voice: named in words, never an image reference. */
  reference: z.boolean(),
});
export type DirectionBinding = z.output<typeof directionBindingSchema>;

export const directionContextSchema = z.object({
  platform_config: platformConfigSchema,
  block_mode: z.enum(BLOCK_MODES),
  creative_bible: creativeBibleShape,
  asset_registry: assetRegistrySchema,
  bindings: z.array(directionBindingSchema),
});
export type DirectionContext = z.output<typeof directionContextSchema>;

/**
 * The asset registry the Director reads (the detector's output_21 with the stored assets'
 * temporary ids) and the id → asset bindings, from the project's stored detection. Voice-only
 * characters are characters here, with no image reference; voices are not assets.
 */
export function registryFromView(view: DetectorView): {
  registry: z.output<typeof assetRegistrySchema>;
  bindings: DirectionBinding[];
} {
  const registry = assetRegistrySchema.parse(view.previousOutput);
  const bindings: DirectionBinding[] = [];
  for (const [id, asset] of view.byTemp) {
    const voiceOnly =
      asset.details?.subkind === "voice_only" || asset.details?.needsVisual === false;
    bindings.push({
      id,
      kind: asset.kind as AssetKind,
      name: asset.name,
      reference: !voiceOnly,
    });
  }
  return { registry, bindings };
}

/** `fixed_<n>` from the bible's block length when it is a platform option, else `auto`. */
export function blockModeFor(bible: CreativeBible | null): BlockMode {
  const length = bible?.project_frame.block_length_sec;
  return length === 15 ? "fixed_15" : length === 30 ? "fixed_30" : "auto";
}

/** The block length used to estimate the count (the bible's, else the platform default). */
export function blockLengthFor(bible: CreativeBible | null, fallback: number): number {
  return bible?.project_frame.block_length_sec ?? fallback;
}

/**
 * How many blocks the script will need: the longer of the target runtime (the episode's for a
 * series) and the script's own spoken length, over the block length. An estimate only, it picks
 * between one `full` call and plan plus batches.
 */
export function estimateBlockCount(input: {
  style: ProjectStyle;
  script: string;
  blockLengthSec: number;
}): number {
  const target = input.style.episodeDurationSeconds ?? input.style.totalDurationSeconds;
  const words = input.script.trim().split(/\s+/).filter(Boolean).length;
  const scriptSeconds = Math.round((words / WORDS_PER_MINUTE) * 60);
  return Math.max(
    1,
    Math.ceil(Math.max(target, scriptSeconds) / Math.max(1, input.blockLengthSec)),
  );
}

/** Inclusive `"from-to"` ranges of `batchSize` blocks covering 1..total. */
export function batchRanges(
  total: number,
  batchSize = BATCH_BLOCKS,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (let from = 1; from <= total; from += batchSize) {
    ranges.push({ from, to: Math.min(total, from + batchSize - 1) });
  }
  return ranges;
}
