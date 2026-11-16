/**
 * Sample BLOCK_REVISION: a minimal-diff answer built from the input, with no Claude call. It copies
 * the current block, bumps the version, and applies each note, confirmed issue and timed note by
 * adding a short directing clause to the action of the shot whose window it overlaps (in `shots`
 * and in `prompt_text`). Hand-offs, dialogue, assets and durations never change, so the answer
 * passes the dami's own `check()`. Not simulated: asset corrections (they would change the
 * staging hand-offs; they are reported in `flags.not_applied`) and the word budget (a note that
 * would push the prompt past 350 words is reported instead of applied).
 */
import { BLOCK_REVISION_VERSION } from "../block-revision/dami";
import {
  blockRevisionInputSchema,
  type BlockRevisionInput,
  type BlockRevisionOutput,
} from "../block-revision/schema";
import type { Shot } from "../director/schema";
import { countWords, parseWindow, windowsOverlap } from "../director/validate";
import { clean } from "./director";

const CAMERA_ALTERNATIVES = [
  "The camera holds locked off.",
  "The camera drifts slowly sideways.",
  "The camera pushes in a few centimetres.",
];

type Applied = {
  source: BlockRevisionOutput["fix_map"][number]["source"];
  ref: string;
  window: string;
  level: number;
  note: string;
};

function shotFor(shots: readonly Shot[], from: number, to: number): Shot | undefined {
  return (
    shots.find((s) => {
      const w = parseWindow(s.window);
      return w !== null && windowsOverlap(w, { from, to });
    }) ?? shots[0]
  );
}

/** The sample answer for Block Revision. */
export function sampleBlockRevision(raw: unknown): BlockRevisionOutput {
  const input: BlockRevisionInput = blockRevisionInputSchema.parse(raw);
  const current = input.current_block;
  const shots: Shot[] = current.shots.map((s) => ({
    ...s,
    dialogue: s.dialogue.map((d) => ({ ...d })),
  }));
  let prompt = current.prompt_text;
  const changeLog: string[] = [];
  const fixMap: BlockRevisionOutput["fix_map"] = [];
  const expected: BlockRevisionOutput["expected_checks"] = [];
  const notApplied: string[] = [];
  const history = (input.attempt_history ?? []).flatMap((a) => a.fixes);
  const requests = input.requests;
  let structural: BlockRevisionOutput["flags"]["structural_suggestion"] = "none";

  const keptItem = (shot: Shot) =>
    (input.keep ?? []).find((k) => {
      const kw = parseWindow(k.window);
      const sw = parseWindow(shot.window);
      return kw !== null && sw !== null && windowsOverlap(kw, sw);
    });
  const isKept = (shot: Shot) => keptItem(shot) !== undefined;

  const apply = (shot: Shot | undefined, applied: Applied, clause: string) => {
    const text = clean(clause).split(/\s+/).slice(0, 14).join(" ");
    if (!shot || !text) {
      notApplied.push(`${applied.ref}: nothing concrete to apply.`);
      return;
    }
    const kept = keptItem(shot);
    if (kept) {
      notApplied.push(
        `${applied.ref}: the window ${kept.window} is kept, so it was left as it is.`,
      );
      return;
    }
    const addition = ` ${text}.`;
    const before = shot.action;
    const after = `${before}${addition}`;
    const next = prompt.includes(before) ? prompt.replace(before, after) : null;
    if (next === null || countWords(next) > 350) {
      notApplied.push(
        `${applied.ref}: the prompt has no room for this change; a split of the block is suggested.`,
      );
      return;
    }
    prompt = next;
    shot.action = after;
    changeLog.push(`${applied.window}: ${text}.`);
    fixMap.push({
      source: applied.source,
      ref: applied.ref,
      window: shot.window,
      level: applied.level,
      change: text,
    });
    expected.push({ window: shot.window, check: `The video shows: ${text}.` });
  };

  if (requests.regenerate) {
    shots.forEach((shot, i) => {
      if (isKept(shot)) return;
      const alternative = CAMERA_ALTERNATIVES[(i + 1) % CAMERA_ALTERNATIVES.length] ?? shot.camera;
      if (alternative !== shot.camera && prompt.includes(shot.camera)) {
        prompt = prompt.replace(shot.camera, alternative);
        shot.camera = alternative;
      }
    });
    changeLog.push(
      "Re-directed: every shot now moves the camera differently; story and dialogue are unchanged.",
    );
  }

  const issues = (input.video_review?.issues ?? []).filter((i) =>
    (requests.observed_issues ?? []).includes(i.issue_id),
  );
  for (const issue of issues) {
    const w = parseWindow(issue.window);
    const failed = history.filter(
      (f) => f.issue_kind === issue.kind && f.window === issue.window && f.outcome === "not_fixed",
    );
    const top = Math.max(0, ...failed.map((f) => f.level));
    const level = Math.min(4, top + 1);
    if (top >= 4) structural = "manual_review";
    apply(
      w ? shotFor(shots, w.from, w.to) : shots[0],
      { source: "issue", ref: issue.issue_id, window: issue.window, level, note: issue.label },
      `${issue.label}: ${issue.planned}`,
    );
  }
  (input.timed_notes ?? []).forEach((note, i) => {
    apply(
      shotFor(shots, note.from_s, note.to_s),
      {
        source: "timed_note",
        ref: `t${i + 1}`,
        window: `${note.from_s}-${note.to_s}s`,
        level: 1,
        note: note.note,
      },
      note.note,
    );
  });
  if (requests.director_notes) {
    apply(
      shots.find((s) => !isKept(s)) ?? shots[0],
      {
        source: "director_note",
        ref: "d1",
        window: `0-${current.duration_s}s`,
        level: 1,
        note: requests.director_notes,
      },
      requests.director_notes,
    );
  }
  const correction = requests.asset_correction;
  if (correction && correction.add.length + correction.remove.length + correction.swap.length > 0) {
    notApplied.push(
      "The sample does not change assets; the real dami adds, removes or swaps them in the prompt and bible lines.",
    );
  }
  if (changeLog.length === 0)
    changeLog.push("Nothing was changed: the requests could not be applied (see not_applied).");

  return {
    dami: "block_revision",
    dami_version: BLOCK_REVISION_VERSION,
    block_id: current.block_id,
    version: current.version + 1,
    based_on_version: current.version,
    duration_s: current.duration_s,
    start_state: current.start_state,
    end_state: current.end_state,
    start_staging: current.start_staging,
    end_staging: current.end_staging,
    staging_meaning: current.staging_meaning,
    opening_frame: current.opening_frame,
    in_progress_at_end: current.in_progress_at_end,
    camera_rationale: requests.regenerate
      ? `${current.camera_rationale} The shot plan was re-directed.`
      : current.camera_rationale,
    editing_rationale: current.editing_rationale,
    assets: current.assets,
    budgets: current.budgets,
    shots,
    applied_rules: current.applied_rules,
    prompt_text: prompt,
    word_count: countWords(prompt),
    change_log: changeLog,
    fix_map: fixMap,
    expected_checks: expected,
    slider_state: {
      pace: 0,
      camera_energy: 0,
      shot_closeness: 0,
      acting_intensity: 0,
      light_mood: 0,
      music_presence: 0,
      delivery_speed: 0,
      staging_distance: 0,
    },
    flags: {
      split_required: false,
      next_block_needs_update: false,
      structural_suggestion: structural,
      not_applied: notApplied,
      input_integrity: [],
    },
  };
}
