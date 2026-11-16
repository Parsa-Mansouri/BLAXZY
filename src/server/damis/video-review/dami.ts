import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { windowKey } from "./windows";
import { buildVideoReviewPrompt, PREV_END_LABEL } from "./prompt";
import {
  videoReviewInputSchema,
  videoReviewOutputSchema,
  type IssueCause,
  type IssueKind,
  type IssueRoute,
  type VideoReviewOutput,
  type VideoReviewParsedInput,
} from "./schema";

export const VIDEO_REVIEW_VERSION = "1.0.0";

/** The fix each cause is for (the owner's three causes). */
export const ROUTE_FOR_CAUSE: Readonly<Record<IssueCause, IssueRoute>> = {
  ai_artifact: "reroll",
  binding_suspect: "rebind",
  instruction_miss: "revise",
};

const ARTIFACT_KINDS: readonly IssueKind[] = ["artifact_face", "artifact_hands", "artifact_other"];
/** What a rendering failure can be: an artifact, or a brief identity drift (owner, step 3). */
const AI_ARTIFACT_KINDS: readonly IssueKind[] = [...ARTIFACT_KINDS, "identity"];
/** What a binding problem can be: the wrong person, place or object (owner, cause 2). */
const BINDING_KINDS: readonly IssueKind[] = ["identity", "location", "look"];

const EPSILON_S = 0.05;

/**
 * Semantic checks the JSON schema cannot express. A miss is fed back to the model once. They hold
 * the owner's rules: evidence cites real frames, one entry per planned window, `pass` only without
 * a blocker or major issue (and `needs_fix` only with one), the route follows the cause, and the
 * cut counts agree with the server's detection.
 */
export function checkVideoReview(out: VideoReviewOutput, input: VideoReviewParsedInput): string[] {
  const errors: string[] = [];
  const frameIds = new Set(input.frames.map((f) => f.id));
  const knownEvidence = (id: string) =>
    frameIds.has(id) || (id === PREV_END_LABEL && input.previous_end_frame !== undefined);
  const unknownFrames = (ids: readonly string[]) => ids.filter((id) => !knownEvidence(id));

  // Echoed ids.
  if (out.block_id !== input.block.block_id)
    errors.push(`block_id must be ${input.block.block_id}`);
  if (out.block_version !== input.block.version) {
    errors.push(`block_version must be ${input.block.version}`);
  }
  if (out.video_version !== input.generation_meta.video_version) {
    errors.push(`video_version must be ${input.generation_meta.video_version}`);
  }

  // Windows: one entry per planned shot window, with that shot's number.
  const planned = new Map(input.block.shots.map((s) => [windowKey(s.window), s.shot_number]));
  const seenWindows = new Set<string>();
  for (const w of out.windows) {
    const key = windowKey(w.window);
    if (!planned.has(key)) errors.push(`windows: "${w.window}" is not a planned window`);
    else if (planned.get(key) !== w.planned_shot) {
      errors.push(`windows: "${w.window}" is planned shot ${planned.get(key)}`);
    }
    if (seenWindows.has(key)) errors.push(`windows: "${w.window}" is listed twice`);
    seenWindows.add(key);
    const bad = unknownFrames(w.frames);
    if (bad.length > 0) errors.push(`windows "${w.window}": unknown frame ids ${bad.join(", ")}`);
  }
  for (const shot of input.block.shots) {
    if (!seenWindows.has(windowKey(shot.window))) {
      errors.push(`windows: planned window "${shot.window}" is missing`);
    }
  }
  const knownWindow = (window: string) => window === "" || planned.has(windowKey(window));

  // Issues.
  const options = new Set(
    [
      ...(input.creative_bible.review_options?.video.technical ?? []),
      ...(input.creative_bible.review_options?.video.preference ?? []),
    ].map((o) => o.id),
  );
  const issueIds = new Set<string>();
  for (const issue of out.issues) {
    const at = `issue ${issue.issue_id}`;
    if (issueIds.has(issue.issue_id)) errors.push(`${at}: duplicate issue_id`);
    issueIds.add(issue.issue_id);
    if (issue.suggested_route !== ROUTE_FOR_CAUSE[issue.cause]) {
      errors.push(
        `${at}: cause ${issue.cause} routes to ${ROUTE_FOR_CAUSE[issue.cause]}, not ${issue.suggested_route}`,
      );
    }
    if (issue.cause === "ai_artifact" && !AI_ARTIFACT_KINDS.includes(issue.kind)) {
      errors.push(
        `${at}: kind ${issue.kind} is not a rendering failure; it is an instruction_miss`,
      );
    }
    if (issue.cause === "binding_suspect" && !BINDING_KINDS.includes(issue.kind)) {
      errors.push(`${at}: binding_suspect is for identity, location or look, not ${issue.kind}`);
    }
    if (ARTIFACT_KINDS.includes(issue.kind) && issue.cause !== "ai_artifact") {
      errors.push(`${at}: kind ${issue.kind} is an ai_artifact`);
    }
    if (issue.evidence.length === 0 && issue.kind !== "audio") {
      errors.push(`${at}: cite at least one frame as evidence`);
    }
    const bad = unknownFrames(issue.evidence);
    if (bad.length > 0) errors.push(`${at}: unknown evidence frame ids ${bad.join(", ")}`);
    if (issue.to_s < issue.from_s) errors.push(`${at}: to_s is before from_s`);
    const duration = input.generation_meta.duration_s;
    if (duration !== undefined && issue.from_s > duration + 0.5) {
      errors.push(`${at}: from_s ${issue.from_s} is past the end of the ${duration} s clip`);
    }
    if (!knownWindow(issue.window)) errors.push(`${at}: "${issue.window}" is not a planned window`);
    if (issue.review_option_id !== "" && !options.has(issue.review_option_id)) {
      errors.push(
        `${at}: review_option_id "${issue.review_option_id}" is not a video review option`,
      );
    }
  }
  const keepIds = new Set<string>();
  for (const keep of out.keep_candidates) {
    if (keepIds.has(keep.id)) errors.push(`keep ${keep.id}: duplicate id`);
    keepIds.add(keep.id);
    if (!knownWindow(keep.window))
      errors.push(`keep ${keep.id}: "${keep.window}" is not a planned window`);
  }

  // Verdict.
  const serious = out.issues.some((i) => i.severity === "blocker" || i.severity === "major");
  if (out.verdict === "pass" && serious) {
    errors.push('verdict "pass" needs no blocker or major issue');
  }
  if (out.verdict === "needs_fix" && !serious) {
    errors.push('verdict "needs_fix" needs at least one blocker or major issue');
  }

  // Cuts.
  const plannedCuts = input.block.shots.length - 1;
  if (out.cuts.planned !== plannedCuts) {
    errors.push(
      `cuts.planned must be ${plannedCuts} (the block has ${input.block.shots.length} shots)`,
    );
  }
  if (out.cuts.planned_times_s.length !== out.cuts.planned) {
    errors.push("cuts.planned_times_s must list one time per planned cut");
  }
  if (out.cuts.detected !== input.detected_cuts.length) {
    errors.push(`cuts.detected must be ${input.detected_cuts.length} (the server's count)`);
  }
  const detected = [...input.detected_cuts].map((c) => c.t).sort((a, b) => a - b);
  const reported = [...out.cuts.detected_times_s].sort((a, b) => a - b);
  if (
    reported.length !== detected.length ||
    reported.some((t, i) => Math.abs(t - detected[i]!) > EPSILON_S)
  ) {
    errors.push("cuts.detected_times_s must be the server's detected cut times");
  }
  const expectedStatus = out.cuts.planned === out.cuts.detected ? "match" : "miss";
  if (out.cuts.status !== expectedStatus) {
    errors.push(
      `cuts.status must be "${expectedStatus}" (planned ${out.cuts.planned}, detected ${out.cuts.detected})`,
    );
  }
  if (out.cuts.status === "miss" && !out.issues.some((i) => i.kind === "cuts")) {
    errors.push('a cuts "miss" needs an issue of kind "cuts" (an instruction_miss)');
  }
  if (out.issues.some((i) => i.kind === "cuts" && i.cause !== "instruction_miss")) {
    errors.push("a cuts issue is an instruction_miss");
  }

  // Identity.
  const assetIds = new Set([
    ...input.reference_binding.map((b) => b.asset_id),
    ...input.sheets.map((s) => s.asset_id),
  ]);
  const sheetIds = new Set(input.sheets.map((s) => s.asset_id));
  for (const id of out.identity) {
    if (!assetIds.has(id.character_id))
      errors.push(`identity: unknown character_id ${id.character_id}`);
    if (!knownWindow(id.window) || id.window === "") {
      errors.push(`identity ${id.character_id}: "${id.window}" is not a planned window`);
    }
    if (id.result === "matches_other_asset" && !sheetIds.has(id.other_asset_id)) {
      errors.push(`identity ${id.character_id}: other_asset_id must name one of the given sheets`);
    }
    const bad = unknownFrames(id.frames);
    if (bad.length > 0)
      errors.push(`identity ${id.character_id}: unknown frame ids ${bad.join(", ")}`);
  }
  const wrongPerson = out.identity.some(
    (i) => i.result === "matches_other_asset" || i.result === "matches_none",
  );
  if (wrongPerson && !out.issues.some((i) => i.kind === "identity")) {
    errors.push('an identity mismatch needs an issue of kind "identity"');
  }

  // Boundary and audio follow what was given.
  const givenPrev = input.previous_end_frame !== undefined;
  if (givenPrev !== (out.boundary.vs_prev_end !== "not_given")) {
    errors.push(
      givenPrev
        ? "boundary.vs_prev_end must compare with PREV_END"
        : 'boundary.vs_prev_end must be "not_given" without PREV_END',
    );
  }
  if (input.transcript === undefined) {
    if (out.audio.status !== "not_checkable") {
      errors.push('audio.status must be "not_checkable" without a transcript');
    }
    if (out.audio.missing_lines.length > 0 || out.audio.unplanned_speech.length > 0) {
      errors.push("audio lines cannot be reported without a transcript");
    }
  } else if (out.audio.status !== "checked") {
    errors.push('audio.status must be "checked" with a transcript');
  }
  return errors;
}

export const videoReview = defineDami({
  key: "video-review",
  version: VIDEO_REVIEW_VERSION,
  description:
    "Inspects a generated clip: compares up to 28 keyframes, the server's detected cuts and the sheets with the block that asked for it, and reports every difference with its cause (rendering failure, wrong reference, or missed instruction) so the router can pick the fix. Not wired yet.",
  input: videoReviewInputSchema,
  output: videoReviewOutputSchema,
  // Sonnet (the owner's choice, vision): one review per generated clip, so volume matters more
  // than the last bit of judgement. Medium effort: telling a rendering failure from a missed
  // instruction, and matching a face against several sheets, benefits from reasoning, and a wrong
  // verdict costs a paid regeneration (several dollars) that a few extra thinking tokens avoid.
  model: CLAUDE_MODELS.sonnet,
  effort: "medium",
  maxOutputTokens: 12_000,
  build: buildVideoReviewPrompt,
  check: checkVideoReview,
});
