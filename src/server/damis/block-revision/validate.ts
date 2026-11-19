/**
 * The owner's `<verify>` list for Block Revision (v1.5), as pure functions over the model's answer
 * and the input. The layout, descriptor, word and budget checks are the Director's (`director/validate.ts`).
 *
 * Checked: duration, windows (2 to 6 s, continuous), budgets, dialogue unchanged, descriptors,
 * hand-offs against the current block and the neighbours, layout and forbidden words, word count,
 * default_avoided and rationales, applied_rules, asset changes only through `asset_correction`,
 * every confirmed issue and timed note answered in `fix_map` or `flags.not_applied`, kept windows,
 * no repeated failed fix, and slider_state all zeros.
 * Not checkable by code: "no must rule, lock or anti-cliche guard broken" and "minimal diff"
 * beyond the hand-offs and kept windows.
 */
import { isDeepStrictEqual } from "node:util";
import {
  bibleRuleIds,
  checkAppliedRules,
  checkAssetIds,
  checkBudgets,
  checkDescriptors,
  checkForbiddenWords,
  checkHeardOnly,
  checkNoVoiceAssets,
  checkOnScreenStaging,
  checkPromptLayout,
  checkRationales,
  checkShotBudget,
  checkShotWindows,
  checkWordCount,
  collapse,
  label,
  parseWindow,
  stagingEqual,
  windowsOverlap,
} from "../director/validate";
import type { ContinuityBible, Shot } from "../director/schema";
import type { BlockRevisionInput, BlockRevisionOutput } from "./schema";

const dialogueOf = (shots: readonly Shot[]) =>
  shots.flatMap((s) => s.dialogue.map((d) => `${d.speaker_id}|${collapse(d.line)}`));

/** Every asset id the continuity bible defines. */
export function bibleAssetIds(bible: ContinuityBible): Set<string> {
  return new Set([
    ...bible.characters.map((c) => c.asset_id),
    ...bible.locations.map((l) => l.asset_id),
    ...bible.props.map((p) => p.asset_id),
  ]);
}

/** Dialogue text, order and speakers are unchanged. */
export function checkDialogueUnchanged(
  output: Pick<BlockRevisionOutput, "block_id" | "shots">,
  current: { shots: readonly Shot[] },
): string[] {
  return isDeepStrictEqual(dialogueOf(output.shots), dialogueOf(current.shots))
    ? []
    : [
        `${label(output)}: dialogue lines, their speakers or their order changed; dialogue is never changed`,
      ];
}

/**
 * Assets enter or leave the block only through `asset_correction`: new ids must be in `add` or be
 * the `to` of a swap; missing ids must be in `remove` or be the `from` of a swap.
 */
export function checkAssetChanges(
  output: Pick<BlockRevisionOutput, "block_id" | "assets">,
  current: Pick<BlockRevisionInput["current_block"], "assets">,
  correction: BlockRevisionInput["requests"]["asset_correction"],
): string[] {
  const errors: string[] = [];
  const add = new Set([...(correction?.add ?? []), ...(correction?.swap ?? []).map((s) => s.to)]);
  const remove = new Set([
    ...(correction?.remove ?? []),
    ...(correction?.swap ?? []).map((s) => s.from),
  ]);
  for (const kind of ["characters", "locations", "props", "heard_only"] as const) {
    const before = new Set(current.assets[kind]);
    const after = new Set(output.assets[kind]);
    for (const id of after) {
      if (!before.has(id) && !add.has(id)) {
        errors.push(
          `${label(output)}: asset "${id}" was added without an asset_correction request`,
        );
      }
    }
    for (const id of before) {
      if (!after.has(id) && !remove.has(id)) {
        errors.push(
          `${label(output)}: asset "${id}" was removed without an asset_correction request`,
        );
      }
    }
  }
  return errors;
}

/**
 * Hand-offs: start_state and start_staging stay (or equal the previous block's end_staging for a
 * continuous or hard-cut block); end_state, end_staging and in_progress_at_end stay unless
 * `flags.next_block_needs_update`, and with it set they must really differ; a continuous next block
 * still gets what it expects unless the flag is set.
 */
export function checkHandOffs(
  output: BlockRevisionOutput,
  input: Pick<BlockRevisionInput, "current_block" | "neighbours">,
): string[] {
  const errors: string[] = [];
  const current = input.current_block;
  const where = label(output);
  const { previous, next } = input.neighbours;
  const chained =
    current.continuity.type === "continuous" || current.continuity.type === "hard_cut";
  const expectedStart = chained && previous ? previous.end_staging : current.start_staging;
  if (!stagingEqual(output.start_staging, expectedStart)) {
    errors.push(
      `${where}: start_staging must stay ${chained && previous ? "equal to the previous block's end_staging" : "as it was"}`,
    );
  }
  if (output.start_state !== current.start_state)
    errors.push(`${where}: start_state must not change`);

  const flagged = output.flags.next_block_needs_update;
  const endChanged =
    !stagingEqual(output.end_staging, current.end_staging) ||
    output.in_progress_at_end !== current.in_progress_at_end;
  if (endChanged && !flagged) {
    errors.push(
      `${where}: end_staging or in_progress_at_end changed: set flags.next_block_needs_update`,
    );
  }
  if (!endChanged && flagged && output.end_state === current.end_state) {
    errors.push(
      `${where}: flags.next_block_needs_update is set but the end hand-off did not change`,
    );
  }
  if (!flagged && output.end_state !== current.end_state) {
    errors.push(`${where}: end_state changed: set flags.next_block_needs_update`);
  }
  const nextChained =
    next?.continuity_type === "continuous" || next?.continuity_type === "hard_cut";
  if (next && nextChained && !flagged && !stagingEqual(output.end_staging, next.start_staging)) {
    errors.push(`${where}: end_staging must equal the next block's start_staging`);
  }
  return errors;
}

/** Windows a timed note covers (every shot window it overlaps), as seconds. */
function noteWindow(note: { from_s: number; to_s: number }) {
  return { from: note.from_s, to: note.to_s };
}

/**
 * Every confirmed issue and every timed note has an entry in `fix_map` (issues by `issue_id`,
 * timed notes by `t1`, `t2`... in order or by an overlapping window), or is named in
 * `flags.not_applied`. Director notes need an entry of source `director_note` or a not_applied note.
 */
export function checkFixMap(
  output: Pick<BlockRevisionOutput, "block_id" | "fix_map" | "flags">,
  input: Pick<BlockRevisionInput, "video_review" | "timed_notes" | "requests">,
): string[] {
  const errors: string[] = [];
  const where = label(output);
  const notApplied = output.flags.not_applied.join(" \n ");
  const issues = (input.video_review?.issues ?? []).filter((i) =>
    (input.requests.observed_issues ?? []).includes(i.issue_id),
  );
  for (const issue of issues) {
    const mapped = output.fix_map.some((f) => f.source === "issue" && f.ref === issue.issue_id);
    if (!mapped && !notApplied.includes(issue.issue_id)) {
      errors.push(
        `${where}: issue ${issue.issue_id} has no fix_map entry and is not named in flags.not_applied`,
      );
    }
  }
  (input.timed_notes ?? []).forEach((note, i) => {
    const ref = `t${i + 1}`;
    const span = noteWindow(note);
    const mapped = output.fix_map.some((f) => {
      if (f.source !== "timed_note") return false;
      if (f.ref === ref) return true;
      const w = parseWindow(f.window);
      return w !== null && windowsOverlap(w, span);
    });
    if (!mapped && !notApplied.includes(ref)) {
      errors.push(
        `${where}: timed note ${ref} (${note.from_s}-${note.to_s} s) has no fix_map entry and is not named in flags.not_applied`,
      );
    }
  });
  if (
    input.requests.director_notes !== undefined &&
    !output.fix_map.some((f) => f.source === "director_note") &&
    output.flags.not_applied.length === 0
  ) {
    errors.push(`${where}: the director note has no fix_map entry and flags.not_applied is empty`);
  }
  return errors;
}

/** Kept windows: shots with a kept window are unchanged, or the change is explained in change_log. */
export function checkKeep(
  output: Pick<BlockRevisionOutput, "block_id" | "shots" | "change_log">,
  current: { shots: readonly Shot[] },
  keep: readonly { window: string; what: string }[],
): string[] {
  const errors: string[] = [];
  for (const item of keep) {
    const kept = parseWindow(item.window);
    if (!kept) continue;
    const before = current.shots.filter((s) => {
      const w = parseWindow(s.window);
      return w !== null && windowsOverlap(w, kept);
    });
    const unchanged = before.every((b) => {
      const now = output.shots.find((s) => s.window === b.window);
      return now !== undefined && isDeepStrictEqual({ ...now }, { ...b });
    });
    const explained = output.change_log.some((line) => line.includes(item.window));
    if (!unchanged && !explained) {
      errors.push(
        `${label(output)}: the kept window ${item.window} changed and change_log does not explain it`,
      );
    }
  }
  return errors;
}

/** A fix that failed for the same issue kind and window is not repeated: its level must climb. */
export function checkAttemptHistory(
  output: Pick<BlockRevisionOutput, "block_id" | "fix_map" | "flags">,
  input: Pick<BlockRevisionInput, "video_review" | "attempt_history">,
): string[] {
  const errors: string[] = [];
  for (const entry of output.fix_map) {
    if (entry.source !== "issue") continue;
    const issue = input.video_review?.issues.find((i) => i.issue_id === entry.ref);
    if (!issue) continue;
    const failed = (input.attempt_history ?? [])
      .flatMap((a) => a.fixes)
      .filter(
        (f) =>
          f.issue_kind === issue.kind && f.window === issue.window && f.outcome === "not_fixed",
      );
    const top = Math.max(0, ...failed.map((f) => f.level));
    if (failed.length > 0 && entry.level <= top && output.flags.structural_suggestion === "none") {
      errors.push(
        `${label(output)}: the fix for ${issue.issue_id} is at level ${entry.level} but level ${top} already failed for this issue; escalate`,
      );
    }
  }
  return errors;
}

/** The `<<<audio_N>>>` tokens of a prompt, in order. */
export function audioTokens(text: string): string[] {
  return [...text.matchAll(/<<<audio_[0-9]+>>>/g)].map((m) => m[0]);
}

/**
 * v1.5: a block VOICE_BOX has bound keeps every `<<<audio_N>>>` token of the current prompt (as
 * many times as it was there).
 */
export function checkAudioTokensKept(
  output: Pick<BlockRevisionOutput, "block_id" | "prompt_text">,
  current: { prompt_text: string },
): string[] {
  const count = (tokens: string[]) => {
    const map = new Map<string, number>();
    for (const t of tokens) map.set(t, (map.get(t) ?? 0) + 1);
    return map;
  };
  const after = count(audioTokens(output.prompt_text));
  return [...count(audioTokens(current.prompt_text))]
    .filter(([token, n]) => (after.get(token) ?? 0) < n)
    .map(
      ([token]) =>
        `${label(output)}: the voice token ${token} of the bound prompt is missing; keep every audio token word for word`,
    );
}

export function checkSliderState(
  output: Pick<BlockRevisionOutput, "block_id" | "slider_state">,
): string[] {
  return Object.entries(output.slider_state)
    .filter(([, v]) => v !== 0)
    .map(
      ([k, v]) =>
        `${label(output)}: slider_state.${k} is ${v}; no slider deltas are sent, so every value is 0`,
    );
}

export function checkBlockRevision(
  output: BlockRevisionOutput,
  input: BlockRevisionInput,
): string[] {
  const current = input.current_block;
  const errors: string[] = [];
  if (output.block_id !== current.block_id) errors.push(`block_id must stay ${current.block_id}`);
  if (output.based_on_version !== current.version)
    errors.push(`based_on_version must be ${current.version}`);
  if (output.version !== current.version + 1) errors.push(`version must be ${current.version + 1}`);
  if (output.duration_s !== current.duration_s)
    errors.push(`duration_s must stay ${current.duration_s}`);

  const split = output.flags.split_required;
  errors.push(...checkShotWindows(output));
  if (!split) {
    errors.push(...checkShotBudget(output));
    errors.push(
      ...checkBudgets(
        output,
        input.platform_config,
        input.creative_bible.project_frame.script_language,
      ),
    );
  }
  errors.push(...checkDialogueUnchanged(output, current));
  errors.push(...checkAssetIds(output, bibleAssetIds(input.continuity_bible)));
  errors.push(...checkAssetChanges(output, current, input.requests.asset_correction));
  errors.push(...checkDescriptors(output, input.continuity_bible));
  errors.push(...checkOnScreenStaging(output));
  errors.push(...checkHeardOnly(output));
  errors.push(...checkNoVoiceAssets(output));
  errors.push(...checkAudioTokensKept(output, current));
  errors.push(...checkPromptLayout(output));
  errors.push(...checkForbiddenWords(output));
  errors.push(...checkWordCount(output));
  errors.push(...checkRationales(output));
  errors.push(...checkAppliedRules(output, bibleRuleIds(input.creative_bible)));
  errors.push(...checkHandOffs(output, input));
  errors.push(...checkFixMap(output, input));
  errors.push(...checkKeep(output, current, input.keep ?? []));
  errors.push(...checkAttemptHistory(output, input));
  errors.push(...checkSliderState(output));
  if (output.change_log.length === 0) errors.push("change_log is empty: one line per change");
  return errors;
}
