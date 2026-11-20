/**
 * Joining DIRECTOR v2.0 answers into one output_22_dir (pure). `full` already is one; a `plan` plus
 * its `write_shots` batches, and later `repair` answers, are joined here, so BREAKDOWN,
 * CINEMATOGRAPHER and PROMPTER always read a `DirectorV2Output`.
 */
import { computeTotals } from "./validate";
import type {
  DirectorV2Output,
  DirectorV2PlanOutput,
  DirectorV2RepairOutput,
  DirectorV2ShotsOutput,
  ShotV2,
  StagingState,
} from "./schema";

function renumber(shots: readonly ShotV2[]): ShotV2[] {
  return shots.map((shot, i) => ({ ...shot, order: i + 1 }));
}

function addStates(base: readonly StagingState[], extra: readonly StagingState[]): StagingState[] {
  const ids = new Set(base.map((s) => s.staging_id));
  return [...base, ...extra.filter((s) => !ids.has(s.staging_id))];
}

/**
 * The plan plus its write_shots batches (any order): shots in scene_plan order, `order`
 * renumbered 1…n across batches, staging states joined, warnings joined, totals computed.
 * Throws when a scene of the plan has no shot (a batch is missing).
 */
export function assembleDirectorV2(
  plan: DirectorV2PlanOutput,
  batches: readonly DirectorV2ShotsOutput[],
  targetRuntimeS: number | null,
): DirectorV2Output {
  const sceneOrder = plan.scene_plan.map((s) => s.scene_id);
  const all = batches.flatMap((b) => b.shots);
  const shots: ShotV2[] = [];
  for (const sceneId of sceneOrder) {
    const scene = all.filter((s) => s.scene_id === sceneId).sort((a, b) => a.order - b.order);
    if (scene.length === 0)
      throw new Error(`Scene ${sceneId} has no shots: a write_shots batch is missing`);
    shots.push(...scene);
  }
  const ordered = renumber(shots);
  const warnings = [...plan.warnings, ...batches.flatMap((b) => b.warnings)];
  return {
    dami: "director",
    dami_version: plan.dami_version,
    mode: "full",
    creative_bible_ref: plan.creative_bible_ref,
    status: warnings.length > 0 ? "ok_with_warnings" : "ok",
    project: plan.project,
    dramatic_analysis: plan.dramatic_analysis,
    directors_notes: plan.directors_notes,
    continuity_bible: plan.continuity_bible,
    scene_plan: plan.scene_plan,
    staging_states: batches.reduce(
      (states, b) => addStates(states, b.staging_states),
      [...plan.staging_states],
    ),
    shots: ordered,
    totals: computeTotals(ordered, targetRuntimeS),
    warnings,
  };
}

/** A repair answer applied: each repaired scene's shots replaced, order renumbered, totals redone. */
export function applyDirectorV2Repairs(
  output: DirectorV2Output,
  repair: DirectorV2RepairOutput,
  targetRuntimeS: number | null,
): DirectorV2Output {
  const byScene = new Map(repair.repairs.map((r) => [r.scene_id, r]));
  const shots: ShotV2[] = [];
  const done = new Set<string>();
  for (const shot of output.shots) {
    const r = byScene.get(shot.scene_id);
    if (!r) shots.push(shot);
    else if (!done.has(shot.scene_id)) {
      done.add(shot.scene_id);
      shots.push(...r.shots);
    }
  }
  const ordered = renumber(shots);
  const warnings = [...output.warnings, ...repair.warnings];
  return {
    ...output,
    status: warnings.length > 0 ? "ok_with_warnings" : output.status,
    staging_states: repair.repairs.reduce(
      (s, r) => addStates(s, r.staging_states),
      [...output.staging_states],
    ),
    shots: ordered,
    totals: computeTotals(ordered, targetRuntimeS),
    warnings,
  };
}
