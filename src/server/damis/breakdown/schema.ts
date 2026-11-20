/**
 * BREAKDOWN v1.0 (output_22_brk): the data contract of the owner's code stage
 * (`source/breakdown.spec.md`, sections 2, 8 and 10). Breakdown itself is deterministic code that
 * a later step builds in this folder; these schemas are what it produces and what DIRECTOR v2.0
 * (repair requests) and PROMPTER v1.0 (units) read. No Claude call ever produces them, so they use
 * ordinary Zod constraints.
 */
import { z } from "zod";
import type { DirectorV2Output } from "../director-v2/schema";
import {
  DELIVERY_MODES,
  type DeliveryMode,
  type PipelinePlatformConfig,
} from "../shared/pipeline-platform";

/** The owner's spec version (`breakdown.spec.md` header). */
export const BREAKDOWN_SPEC_VERSION = "1.0";

const text = z.string();
const seconds = z.number().int().min(0);

/* -------------------------------------------------------------------------- */
/* Input (section 2)                                                           */
/* -------------------------------------------------------------------------- */

export type BreakdownInput = {
  delivery_mode: DeliveryMode;
  platform: PipelinePlatformConfig;
  script_language: string;
  target_runtime_s: number;
  /** output_22_dir, assembled (full mode, or the plan plus every write_shots batch). */
  director: DirectorV2Output;
};

/* -------------------------------------------------------------------------- */
/* Repair requests (section 8), DIRECTOR v2.0's `<repair_requests>`            */
/* -------------------------------------------------------------------------- */

export const REPAIR_PROBLEMS = [
  "no_fit",
  "events_overflow",
  "dialogue_overflow",
  "shot_budget",
  "never_chain",
] as const;
export type RepairProblem = (typeof REPAIR_PROBLEMS)[number];

export const breakdownRepairRequestSchema = z.object({
  scene_id: text.min(1),
  problem: z.enum(REPAIR_PROBLEMS),
  sum_min_s: seconds,
  sum_max_s: seconds,
  need: z.enum(["add", "remove"]),
  target_options_s: z.array(z.number().int().positive()),
  note: text,
});
export type BreakdownRepairRequest = z.output<typeof breakdownRepairRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Output (section 10)                                                         */
/* -------------------------------------------------------------------------- */

export const UNIT_TYPES = ["block", "shot"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/** How PROMPTER opens each shot line of a unit. */
export const CUT_INS = ["first", "cut", "no_cut", "scene_cut"] as const;
export type CutIn = (typeof CUT_INS)[number];

export const UNIT_CONTINUITY_TYPES = [
  "first",
  "continuous",
  "hard_cut",
  "time_jump",
  "new_scene",
] as const;
export type UnitContinuityType = (typeof UNIT_CONTINUITY_TYPES)[number];

export const BREAKDOWN_STATUSES = [
  "ok",
  "ok_with_warnings",
  "needs_repair",
  "needs_user_decision",
  "invalid_input",
] as const;
export type BreakdownStatus = (typeof BREAKDOWN_STATUSES)[number];

export const BREAKDOWN_WARNING_TYPES = [
  "merged_scenes",
  "stretched",
  "trim_anchor_missing",
  "split_never_boundary",
  "runtime",
  "other",
] as const;

export const breakdownWarningSchema = z.object({
  type: z.enum(BREAKDOWN_WARNING_TYPES),
  ref: text,
  message: text,
});
export type BreakdownWarning = z.output<typeof breakdownWarningSchema>;

/** One shot inside a unit, with its window in seconds from the unit's start ("0-5s"). */
export const unitShotSchema = z.object({
  shot_id: text.min(1),
  window: text.regex(/^\d+-\d+s$/),
  start_s: seconds,
  end_s: seconds,
  duration_s: z.number().int().positive(),
  cut_in: z.enum(CUT_INS),
});
export type UnitShot = z.output<typeof unitShotSchema>;

/** One generation unit: a 15 / 30 s block or one shot. PROMPTER writes one prompt per unit. */
export const breakdownUnitSchema = z.object({
  unit_id: z.number().int().positive(),
  unit_type: z.enum(UNIT_TYPES),
  /** The length used in the film (`use_s` in shot mode). */
  duration_s: z.number().int().positive(),
  /** The length Seedance generates (≥ duration_s; larger only for a trimmed shot). */
  generate_s: z.number().int().positive(),
  trim: z.enum(["head", "tail", "center"]).nullable(),
  scene_ids: z.array(text).min(1),
  location_ids: z.array(text),
  shots: z.array(unitShotSchema).min(1),
  start_staging_id: text,
  end_staging_id: text,
  /** The first shot's state_at_start. */
  opening_frame: text,
  /** The last shot's in_progress_at_end. */
  in_progress_at_end: text,
  continuity: z.object({
    type: z.enum(UNIT_CONTINUITY_TYPES),
    /** True only for "continuous" (same camera setup, no cut). */
    use_last_frame_as_start: z.boolean(),
  }),
  budgets: z.object({
    spoken_words: z.number().int().min(0),
    spoken_words_max: z.number().int().min(0),
    events: z.number().int().min(0),
    events_max: z.number().int().min(0),
    shot_budget: z.enum(["standard", "rapid_cut"]),
    shots_counted: z.number().int().min(0),
  }),
  warnings: z.array(breakdownWarningSchema),
});
export type BreakdownUnit = z.output<typeof breakdownUnitSchema>;

export const breakdownOutputSchema = z.object({
  stage: z.literal("breakdown"),
  version: text,
  status: z.enum(BREAKDOWN_STATUSES),
  delivery_mode: z.enum(DELIVERY_MODES),
  units: z.array(breakdownUnitSchema),
  repair_requests: z.array(breakdownRepairRequestSchema),
  totals: z.object({
    unit_count: z.number().int().min(0),
    count_15: z.number().int().min(0),
    count_30: z.number().int().min(0),
    count_shot: z.number().int().min(0),
    total_runtime_s: z.number().min(0),
    target_runtime_s: z.number().min(0),
    deviation_pct: z.number(),
  }),
  warnings: z.array(breakdownWarningSchema),
});
export type BreakdownOutput = z.output<typeof breakdownOutputSchema>;

/** `"4-9s"` → { from: 4, to: 9 }, or null. */
export function parseUnitWindow(window: string): { from: number; to: number } | null {
  const match = /^(\d+)-(\d+)s$/.exec(window.trim());
  return match ? { from: Number(match[1]), to: Number(match[2]) } : null;
}
