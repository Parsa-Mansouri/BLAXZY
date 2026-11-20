/**
 * PROMPTER v1.0: the owner's `<inputs>` and `<output_format>` as Zod. The output is one prompter
 * unit per BREAKDOWN unit; the assembler (code) merges BREAKDOWN unit + DIRECTOR shots +
 * CINEMATOGRAPHER shots + `prompt_text` into an output_22 block (the v1.4 block shape).
 */
import { z } from "zod";
import { creativeBibleShape } from "../creative-dna/schema";
import { assetRegistrySchema } from "../director/schema";
import {
  continuityBibleV2Schema,
  directorsNotesV2Schema,
  directorV2ProjectSchema,
  shotV2Schema,
  stagingStateSchema,
} from "../director-v2/schema";
import { dpShotSchema, lookBibleSchema } from "../cinematographer/schema";
import { breakdownUnitSchema, UNIT_TYPES } from "../breakdown/schema";
import {
  defaultPipelinePlatformConfig,
  pipelinePlatformConfigSchema,
} from "../shared/pipeline-platform";

const text = z.string();

export const PROMPTER_WARNING_TYPES = [
  "input_integrity",
  "missing_shot_data",
  "over_length",
  "guard",
  "other",
] as const;
export const prompterWarningSchema = z.object({
  type: z.enum(PROMPTER_WARNING_TYPES),
  ref: text,
  message: text,
});
export type PrompterWarning = z.output<typeof prompterWarningSchema>;

export const PROMPTER_UNIT_STATUSES = ["ok", "over_length", "skipped"] as const;

/** One written unit: the prompt Seedance receives, with what it uses. */
export const prompterUnitSchema = z.object({
  unit_id: z.number().int(),
  unit_type: z.enum(UNIT_TYPES),
  status: z.enum(PROMPTER_UNIT_STATUSES),
  duration_s: z.number().int(),
  generate_s: z.number().int(),
  assets: z.object({
    characters: z.array(text),
    locations: z.array(text),
    props: z.array(text),
    heard_only: z.array(text),
  }),
  light_ids: z.array(text),
  dialogue_lines: z.number().int(),
  applied_rules: z.array(text),
  /** "BEGIN PROMPT\n...\nEND PROMPT" */
  prompt_text: text,
  word_count: z.number().int(),
  warnings: z.array(prompterWarningSchema),
});
export type PrompterUnit = z.output<typeof prompterUnitSchema>;

export const prompterOutputSchema = z.object({
  dami: z.literal("prompter"),
  dami_version: text,
  status: z.enum(["ok", "ok_with_warnings"]),
  units: z.array(prompterUnitSchema),
  warnings: z.array(prompterWarningSchema),
});
export type PrompterOutput = z.output<typeof prompterOutputSchema>;

/** `<director>`: output_22_dir's project, notes, bible, staging states and the units' shots. */
export const prompterDirectorSchema = z.object({
  project: directorV2ProjectSchema,
  directors_notes: directorsNotesV2Schema,
  continuity_bible: continuityBibleV2Schema,
  staging_states: z.array(stagingStateSchema),
  /** At least the units' shots; the film's shots in order also work (costume versions). */
  shots: z.array(shotV2Schema),
});
export type PrompterDirector = z.output<typeof prompterDirectorSchema>;

/** `<cinematographer>`: output_22_dp's look bible and the units' shots. */
export const prompterCinematographerSchema = z.object({
  look_bible: lookBibleSchema,
  shots: z.array(dpShotSchema),
});
export type PrompterCinematographer = z.output<typeof prompterCinematographerSchema>;

export const prompterInputSchema = z.object({
  platform_config: pipelinePlatformConfigSchema.default(defaultPipelinePlatformConfig),
  creative_bible: creativeBibleShape,
  asset_registry: assetRegistrySchema,
  director: prompterDirectorSchema,
  cinematographer: prompterCinematographerSchema,
  /** A batch of output_22_brk units (~8). */
  units: z.array(breakdownUnitSchema).min(1).max(16),
});
export type PrompterInput = z.output<typeof prompterInputSchema>;
