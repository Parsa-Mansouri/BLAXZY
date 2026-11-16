/**
 * Sample video review: a deterministic report built from the input's metadata only (the block's
 * windows, the labelled frames, the detected cut count). It never looks at an image. A clip whose
 * detected cut count differs from the plan gets one instruction_miss "cuts" issue (so the sample
 * flow can show a needs_fix); anything else passes with a keep candidate per window.
 */
import { windowKey } from "../video-review/windows";
import {
  videoReviewInputSchema,
  videoReviewOutputSchema,
  type ReviewFrame,
  type VideoReviewOutput,
} from "../video-review/schema";

/** The frames of a window: the label of each frame names its window (`window 4-9s`). */
function framesOf(window: string, frames: readonly ReviewFrame[]): ReviewFrame[] {
  const key = windowKey(window);
  return frames.filter((f) => {
    const match = /\bwindow (\S+) planned shot/.exec(f.label);
    return match?.[1] !== undefined && windowKey(match[1]) === key;
  });
}

/** The start second of a window (`4-9s` → 4), 0 when it cannot be read. */
function windowStart(window: string): number {
  const n = Number.parseFloat(window);
  return Number.isFinite(n) ? n : 0;
}

export function sampleVideoReview(raw: unknown): VideoReviewOutput {
  const input = videoReviewInputSchema.parse(raw);
  const { block, frames } = input;
  const plannedCuts = block.shots.length - 1;
  const detected = [...input.detected_cuts].map((c) => c.t).sort((a, b) => a - b);
  const cutsMatch = plannedCuts === detected.length;
  const firstFrame = frames[0]!;
  const lastFrame = frames[frames.length - 1]!;

  const windows = block.shots.map((shot) => ({
    window: shot.window,
    planned_shot: shot.shot_number,
    status: "match" as const,
    observed: `Sample review: shot ${shot.shot_number} is taken to match the plan.`,
    differences: [],
    frames: framesOf(shot.window, frames).map((f) => f.id),
  }));

  const characters = [...new Set(input.reference_binding.map((b) => b.asset_id))].filter((id) =>
    id.startsWith("char"),
  );
  const identity = characters.flatMap((character) =>
    windows
      .filter((w) => w.frames.length > 0)
      .map((w) => ({
        character_id: character,
        window: w.window,
        result: "matches_planned" as const,
        other_asset_id: "",
        confidence: "low" as const,
        frames: w.frames.slice(0, 2),
      })),
  );

  const issues: VideoReviewOutput["issues"] = cutsMatch
    ? []
    : [
        {
          issue_id: "i1",
          cause: "instruction_miss",
          kind: "cuts",
          severity: "major",
          from_s: 0,
          to_s: input.generation_meta.duration_s ?? lastFrame.t,
          window: "",
          planned: `${plannedCuts} cut${plannedCuts === 1 ? "" : "s"}`,
          observed: `${detected.length} cut${detected.length === 1 ? "" : "s"} detected`,
          evidence: [firstFrame.id, lastFrame.id].filter((id, i, all) => all.indexOf(id) === i),
          review_option_id: "",
          label: `The clip has ${detected.length} cut${detected.length === 1 ? "" : "s"} instead of the planned ${plannedCuts}.`,
          suggested_route: "revise",
        },
      ];

  const keep: VideoReviewOutput["keep_candidates"] = windows
    .filter((w) => w.frames.length > 0)
    .slice(0, 2)
    .map((w, i) => ({
      id: `k${i + 1}`,
      window: w.window,
      what: `Shot ${w.planned_shot} as rendered`,
      label: `Shot ${w.planned_shot} looks as planned.`,
    }));

  const output: VideoReviewOutput = {
    dami: "video_review",
    dami_version: "1.0",
    block_id: block.block_id,
    block_version: block.version,
    video_version: input.generation_meta.video_version,
    verdict: cutsMatch ? "pass" : "needs_fix",
    windows,
    cuts: {
      planned: plannedCuts,
      detected: detected.length,
      planned_times_s: block.shots.slice(1).map((s) => windowStart(s.window)),
      detected_times_s: detected,
      status: cutsMatch ? "match" : "miss",
    },
    identity,
    boundary: {
      opening: "match",
      opening_notes: "",
      restarted_action: false,
      vs_prev_end: input.previous_end_frame ? "match" : "not_given",
      ending: "match",
      ending_notes: "",
    },
    audio: {
      status: input.transcript ? "checked" : "not_checkable",
      missing_lines: [],
      unplanned_speech: [],
    },
    issues,
    keep_candidates: keep,
    not_checkable: ["Lip sync", "Voice identity", "Motion smoothness between frames"],
  };
  return videoReviewOutputSchema.parse(output);
}
