/**
 * Test and fixture helper, NOT BREAKDOWN: naive output_22_brk units for a director output, so the
 * Prompter's tests and `pnpm dami:run prompter` fixture have input before the real BREAKDOWN
 * exists. Block units: up to two shots of one scene at their ideal lengths (no 15/30 s packing). Shot
 * units: one per shot, generated at max(ideal, unit_min_s).
 */
import type { BreakdownUnit, UnitShot } from "../breakdown/schema";
import type { DirectorV2Output, ShotV2 } from "../director-v2/schema";

function unitFrom(
  id: number,
  shots: readonly ShotV2[],
  previous: ShotV2 | null,
  type: "block" | "shot",
  unitMinS: number,
): BreakdownUnit {
  const first = shots[0];
  const last = shots[shots.length - 1];
  if (!first || !last) throw new Error("a unit needs shots");
  const duration = shots.reduce((s, x) => s + x.duration.ideal_s, 0);
  const generate = type === "shot" ? Math.max(duration, unitMinS) : duration;
  let t = 0;
  const unitShots: UnitShot[] = shots.map((s, i) => {
    const d = type === "shot" ? generate : s.duration.ideal_s;
    const shot: UnitShot = {
      shot_id: s.shot_id,
      window: `${t}-${t + d}s`,
      start_s: t,
      end_s: t + d,
      duration_s: d,
      cut_in:
        i === 0 ? "first" : shots[i - 1]?.transition_after === "continuous" ? "no_cut" : "cut",
    };
    t += d;
    return shot;
  });
  const continuity = !previous
    ? "first"
    : previous.transition_after === "continuous"
      ? "continuous"
      : previous.transition_after === "time_jump"
        ? "time_jump"
        : previous.transition_after === "scene_change"
          ? "new_scene"
          : "hard_cut";
  const words = shots.reduce((s, x) => s + x.spoken_words, 0);
  const events = shots.reduce((s, x) => s + x.events, 0);
  return {
    unit_id: id,
    unit_type: type,
    duration_s: duration,
    generate_s: generate,
    trim: generate > duration ? (first.trim_anchor ?? "center") : null,
    scene_ids: [...new Set(shots.map((s) => s.scene_id))],
    location_ids: [...new Set(shots.map((s) => s.location_id))],
    shots: unitShots,
    start_staging_id: first.staging_start_id,
    end_staging_id: last.staging_end_id,
    opening_frame: first.state_at_start,
    in_progress_at_end: last.in_progress_at_end,
    continuity: { type: continuity, use_last_frame_as_start: continuity === "continuous" },
    budgets: {
      spoken_words: words,
      spoken_words_max: words,
      events,
      events_max: Math.max(events, 1),
      shot_budget: "standard",
      shots_counted: shots.length,
    },
    warnings: [],
  };
}

export function sampleUnits(
  director: DirectorV2Output,
  type: "block" | "shot",
  unitMinS = 4,
): BreakdownUnit[] {
  const units: BreakdownUnit[] = [];
  let previous: ShotV2 | null = null;
  const groups: ShotV2[][] =
    type === "shot"
      ? director.shots.map((s) => [s])
      : director.scene_plan.flatMap((p) => {
          const scene = director.shots.filter((s) => s.scene_id === p.scene_id);
          const chunks: ShotV2[][] = [];
          for (let i = 0; i < scene.length; i += 2) chunks.push(scene.slice(i, i + 2));
          return chunks;
        });
  for (const group of groups) {
    if (group.length === 0) continue;
    units.push(unitFrom(units.length + 1, group, previous, type, unitMinS));
    previous = group[group.length - 1] ?? null;
  }
  return units;
}
