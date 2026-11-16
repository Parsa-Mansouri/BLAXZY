/**
 * The Director's data of a block as the screens read it. The stored `prompt_block.direction` is the
 * Director's output for the block (see `damis/director/schema.ts`) plus `asset_names` (the
 * Director's ids to the assets' names). This reader is lenient on purpose: a block written by an
 * older Director version, or a field the model left odd, shows what it can instead of failing the
 * page. Pure.
 */
import { z } from "zod";

const text = z.string().catch("");
const num = z.number().catch(0);

const stagingView = z.object({
  character_id: text,
  on_screen: z.boolean().catch(true),
  position: text,
  posture: text,
  facing: text,
  gaze: text,
  screen_side: text,
  distances: z.array(z.object({ to: text, zone: text, approx_m: num })).catch([]),
});

const shotView = z.object({
  window: text,
  shot_number: num,
  shot: text,
  angle: text,
  camera_height: text,
  camera: text,
  action: text,
  staging_change: text,
  cut_reason: text,
  dialogue: z.array(z.object({ speaker_id: text, line: text, delivery: text })).catch([]),
});

/** What the last Block Revision of the block reported (stored under `direction.revision`). */
const revisionView = z.object({
  based_on_version: num,
  change_log: z.array(text).catch([]),
  flags: z
    .object({
      split_required: z.boolean().catch(false),
      next_block_needs_update: z.boolean().catch(false),
      structural_suggestion: text.catch("none"),
      not_applied: z.array(text).catch([]),
    })
    .catch({
      split_required: false,
      next_block_needs_update: false,
      structural_suggestion: "none",
      not_applied: [],
    }),
});
export type RevisionView = z.output<typeof revisionView>;

export const blockDirectionSchema = z.object({
  scene_heading: text,
  dramatic_function: text,
  duration_s: num,
  start_state: text,
  end_state: text,
  start_staging: z.array(stagingView).catch([]),
  end_staging: z.array(stagingView).catch([]),
  staging_meaning: text,
  opening_frame: text,
  in_progress_at_end: text,
  continuity: z.object({ type: text, note: text }).catch({ type: "", note: "" }),
  camera_rationale: text,
  editing_rationale: text,
  shots: z.array(shotView).catch([]),
  /** The Director's ids (`char_1`) to the names of the assets they stand for. */
  asset_names: z.record(z.string(), z.string()).catch({}),
  /** Set on a block that Block Revision rewrote; absent on the Director's own version. */
  revision: revisionView.nullable().catch(null),
});

export type BlockDirectionView = z.output<typeof blockDirectionSchema>;
export type ShotView = z.output<typeof shotView>;
export type StagingView = z.output<typeof stagingView>;

/** The block's direction for display, or null for a block cut before the Director existed. */
export function parseBlockDirection(raw: unknown): BlockDirectionView | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const parsed = blockDirectionSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.shots.length > 0 ? parsed.data : null;
}
