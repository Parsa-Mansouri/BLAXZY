/**
 * The owner's `<code_side_validator>` for the Director (v1.4), as pure functions: each takes the
 * data it needs and returns the error messages (empty = passes). `checkDirector` and
 * `checkDirectorPlan` compose them for `dami.check()`; Block Revision reuses the block-level ones.
 *
 * Where this deviates from the owner's text (each is noted at its function):
 * - The forbidden-word regex ignores the text of spoken dialogue lines: a script line such as
 *   "I still love you" must be pasted verbatim, and the owner's regex would otherwise reject it.
 * - `script_coverage` is checked as far as quotes can be checked (see `checkScriptCoverage`).
 */
import { isDeepStrictEqual } from "node:util";
import { speechRateWps } from "../shared/platform";
import type { CreativeBible } from "../creative-dna/schema";
import {
  parseBlockRange,
  registryAssetIds,
  type AnyDirectorInput,
  type AssetRegistry,
  type Block,
  type BlockMode,
  type ContinuityBible,
  type DirectorOutput,
  type DirectorPlanOutput,
  type PlanBlock,
  type PlannedShot,
  type PlatformConfigInput,
  type Shot,
  type Staging,
} from "./schema";

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/** What the block-level checks read; a Block Revision output has all of these too. */
export type PromptBlock = Pick<
  Block,
  | "block_id"
  | "duration_s"
  | "shots"
  | "prompt_text"
  | "word_count"
  | "assets"
  | "start_staging"
  | "end_staging"
  | "budgets"
  | "camera_rationale"
  | "editing_rationale"
  | "applied_rules"
>;

export const label = (block: { block_id: number }) => `block ${block.block_id}`;

export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

export type ShotWindow = { from: number; to: number };

/** `"4-9s"` (also `"4–9 s"`, `"0-4.5s"`) as numbers, or null. */
export function parseWindow(window: string): ShotWindow | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*s?\s*$/.exec(window);
  if (!match) return null;
  return { from: Number(match[1]), to: Number(match[2]) };
}

/** Shot windows overlap when they share more than a boundary point. */
export function windowsOverlap(a: ShotWindow, b: ShotWindow): boolean {
  return a.from < b.to && b.from < a.to;
}

/** Order-independent form of a staging list, for equality. */
function normalizeStaging(staging: readonly Staging[]): Staging[] {
  return staging
    .map((s) => ({ ...s, distances: [...s.distances].sort((a, b) => a.to.localeCompare(b.to)) }))
    .sort((a, b) => a.character_id.localeCompare(b.character_id));
}

export function stagingEqual(a: readonly Staging[], b: readonly Staging[]): boolean {
  return isDeepStrictEqual(normalizeStaging(a), normalizeStaging(b));
}

/** Every rule id of the bible (all slices, series rules included). */
export function bibleRuleIds(bible: CreativeBible): Set<string> {
  const ids = new Set<string>();
  for (const slice of Object.values(bible.slices)) {
    for (const rule of slice.rules) ids.add(rule.id);
  }
  for (const rule of bible.slices.for_script_writer.series_rules) ids.add(rule.id);
  return ids;
}

/* -------------------------------------------------------------------------- */
/* Block-level checks                                                          */
/* -------------------------------------------------------------------------- */

/** duration_s is 15 or 30 and, in a fixed mode, the mode's length. */
export function checkDuration(
  block: { block_id: number; duration_s: number },
  blockMode: BlockMode,
  allowed: readonly number[] = [15, 30],
): string[] {
  const errors: string[] = [];
  if (!allowed.includes(block.duration_s)) {
    errors.push(
      `${label(block)}: duration_s ${block.duration_s} is not one of ${allowed.join(", ")}`,
    );
  }
  const fixed = blockMode === "fixed_15" ? 15 : blockMode === "fixed_30" ? 30 : null;
  if (fixed !== null && block.duration_s !== fixed) {
    errors.push(`${label(block)}: block_mode ${blockMode} needs duration_s ${fixed}`);
  }
  return errors;
}

/** A prompt window's length in seconds, inclusive (the owner's 2 to 6 s). */
export const SHOT_WINDOW_MIN_S = 2;
export const SHOT_WINDOW_MAX_S = 6;

/**
 * The one window rule, shared by Director and Block Revision. A window is a timed prompt segment
 * of `minSeconds` to `maxSeconds` (default 2 to 6 s; rapid-cut windows of 2 to 3 s fit). Windows
 * run continuously from 0 to duration_s. A shot may span several consecutive windows: a
 * continuation window repeats the previous shot_number and is written without "Cut to"; a new shot
 * is previous + 1 (the first is 1) and is written "Cut to Shot N". The prompt must say "Cut to
 * Shot N" exactly once for every shot after the first, and never for another number.
 */
export function checkShotWindows(
  block: Pick<PromptBlock, "block_id" | "duration_s" | "shots"> & { prompt_text?: string },
  options: { minSeconds?: number; maxSeconds?: number } = {},
): string[] {
  const errors: string[] = [];
  const min = options.minSeconds ?? SHOT_WINDOW_MIN_S;
  const max = options.maxSeconds ?? SHOT_WINDOW_MAX_S;
  let cursor = 0;
  let previous = 0;
  const numbers: number[] = [];
  block.shots.forEach((shot, i) => {
    const where = `${label(block)} window ${i + 1}`;
    if (shot.shot_number !== previous && shot.shot_number !== previous + 1) {
      errors.push(
        `${where}: shot_number ${shot.shot_number} must be ${previous === 0 ? 1 : `${previous} (continuation) or ${previous + 1} (cut)`}`,
      );
    }
    previous = shot.shot_number;
    if (!numbers.includes(shot.shot_number)) numbers.push(shot.shot_number);
    const w = parseWindow(shot.window);
    if (!w) {
      errors.push(`${where}: window "${shot.window}" is not like "0-4s"`);
      return;
    }
    if (w.from !== cursor) {
      errors.push(
        `${where}: window starts at ${w.from} s, expected ${cursor} s (no gaps, no overlaps)`,
      );
    }
    if (w.to <= w.from) errors.push(`${where}: window "${shot.window}" ends before it starts`);
    else {
      const length = w.to - w.from;
      if (length < min) errors.push(`${where}: window is ${length} s, the minimum is ${min} s`);
      if (length > max) errors.push(`${where}: window is ${length} s, the maximum is ${max} s`);
    }
    cursor = w.to;
  });
  if (block.shots.length > 0 && cursor !== block.duration_s) {
    errors.push(
      `${label(block)}: shot windows end at ${cursor} s, duration_s is ${block.duration_s}`,
    );
  }
  if (block.prompt_text !== undefined) {
    const cuts = [...block.prompt_text.matchAll(/Cut to Shot (\d+)/g)].map((m) => Number(m[1]));
    for (const n of numbers.filter((n) => n > 1)) {
      const count = cuts.filter((c) => c === n).length;
      if (count !== 1) {
        errors.push(
          `${label(block)}: the prompt says "Cut to Shot ${n}" ${count} times, expected once`,
        );
      }
    }
    for (const c of new Set(cuts)) {
      if (!numbers.includes(c) || c === 1) {
        errors.push(
          `${label(block)}: the prompt says "Cut to Shot ${c}" but no such shot change is in shots`,
        );
      }
    }
  }
  return errors;
}

/** Distinct shots (shot_numbers) of a block. */
export const shotCount = (shots: readonly { shot_number: number }[]) =>
  new Set(shots.map((s) => s.shot_number)).size;

/** Distinct-shot limit by budget (standard 3/5, rapid_cut 5/10 for 15/30 s). */
export function shotLimit(duration: number, budget: "standard" | "rapid_cut"): number {
  const long = duration >= 30;
  return budget === "rapid_cut" ? (long ? 10 : 5) : long ? 5 : 3;
}

export function checkShotBudget(
  block: Pick<PromptBlock, "block_id" | "duration_s" | "shots" | "budgets" | "editing_rationale">,
): string[] {
  const errors: string[] = [];
  const budget = block.budgets.shot_budget;
  const limit = shotLimit(block.duration_s, budget);
  const shots = shotCount(block.shots);
  if (shots > limit) {
    errors.push(
      `${label(block)}: ${shots} shots exceed the ${budget} budget of ${limit} for ${block.duration_s} s`,
    );
  }
  if (budget === "rapid_cut" && block.editing_rationale.trim() === "") {
    errors.push(`${label(block)}: a rapid_cut block needs its justification in editing_rationale`);
  }
  return errors;
}

/**
 * Spoken words and events within budget: dialogue (counted from the shots, not the field) fits
 * `spoken_words_max`; the max itself is at most the speech rate x duration minus 30 % (the
 * owner's process) and the events at most `max_events_per_block`.
 */
export function checkBudgets(
  block: Pick<PromptBlock, "block_id" | "duration_s" | "shots" | "budgets">,
  platform: PlatformConfigInput,
  language: string | null | undefined,
): string[] {
  const errors: string[] = [];
  const spoken = spokenWords(block.shots);
  if (spoken > block.budgets.spoken_words_max) {
    errors.push(
      `${label(block)}: ${spoken} spoken words exceed spoken_words_max ${block.budgets.spoken_words_max}`,
    );
  }
  const ceiling = spokenWordsCeiling(platform, language, block.duration_s);
  if (block.budgets.spoken_words_max > ceiling) {
    errors.push(
      `${label(block)}: spoken_words_max ${block.budgets.spoken_words_max} is above ${ceiling} (speech rate x duration minus 30% for action)`,
    );
  }
  const maxEvents = platform.max_events_per_block[String(block.duration_s)];
  if (maxEvents !== undefined && block.budgets.events > maxEvents) {
    errors.push(
      `${label(block)}: ${block.budgets.events} events exceed max_events_per_block ${maxEvents}`,
    );
  }
  return errors;
}

/**
 * The most words a block of `duration` seconds may speak: the speech rate of the language times
 * the duration, minus 30 % for action and reaction (the owner's process). The Breakdown packs
 * shots under the same number.
 */
export function spokenWordsCeiling(
  platform: PlatformConfigInput,
  language: string | null | undefined,
  duration: number,
): number {
  const rate =
    platform.speech_rate_wps[(language ?? "").toLowerCase().split(/[-_]/)[0] ?? ""] ??
    speechRateWps(language);
  return Math.floor(rate * duration * 0.7);
}

export function spokenWords(shots: readonly Pick<Shot, "dialogue">[]): number {
  return shots.reduce(
    (sum, shot) => sum + shot.dialogue.reduce((s, d) => s + countWords(d.line), 0),
    0,
  );
}

/** Every asset id the block and the bible use exists in output_21 or starts with `new_`. */
export function checkAssetIds(
  block: Pick<PromptBlock, "block_id" | "assets">,
  known: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const id of [
    ...block.assets.characters,
    ...block.assets.locations,
    ...block.assets.props,
    ...block.assets.heard_only,
  ]) {
    if (!known.has(id) && !id.startsWith("new_")) {
      errors.push(
        `${label(block)}: asset_id "${id}" is not in output_21 and does not start with "new_"`,
      );
    }
  }
  return errors;
}

export function checkBibleAssetIds(bible: ContinuityBible, known: ReadonlySet<string>): string[] {
  const ids = [
    ...bible.characters.map((c) => c.asset_id),
    ...bible.locations.map((l) => l.asset_id),
    ...bible.props.map((p) => p.asset_id),
  ];
  return ids
    .filter((id) => !known.has(id) && !id.startsWith("new_"))
    .map(
      (id) =>
        `continuity_bible: asset_id "${id}" is not in output_21 and does not start with "new_"`,
    );
}

/** The descriptor a block must use for an asset (the costume version in force, for a character). */
export function descriptorFor(
  bible: ContinuityBible,
  assetId: string,
  blockId: number,
): string | null {
  const character = bible.characters.find((c) => c.asset_id === assetId);
  if (character) {
    const version = character.costume_versions
      .filter((v) => v.from_block <= blockId)
      .sort((a, b) => b.from_block - a.from_block)[0];
    return version ? version.descriptor : character.descriptor;
  }
  return (
    bible.locations.find((l) => l.asset_id === assetId)?.descriptor ??
    bible.props.find((p) => p.asset_id === assetId)?.descriptor ??
    null
  );
}

/** Each bible descriptor appears verbatim (whitespace-collapsed) in the block's prompt_text. */
export function checkDescriptors(
  block: Pick<PromptBlock, "block_id" | "assets" | "prompt_text">,
  bible: ContinuityBible,
): string[] {
  const errors: string[] = [];
  const prompt = collapse(block.prompt_text);
  for (const id of [...block.assets.characters, ...block.assets.locations, ...block.assets.props]) {
    const descriptor = descriptorFor(bible, id, block.block_id);
    if (descriptor === null) {
      errors.push(`${label(block)}: asset "${id}" has no entry in continuity_bible`);
    } else if (!prompt.includes(collapse(descriptor))) {
      errors.push(
        `${label(block)}: the descriptor of "${id}" is not pasted word for word in prompt_text`,
      );
    }
  }
  return errors;
}

/** prompt_text starts "BEGIN PROMPT", ends "END PROMPT" and has the four required markers. */
export function checkPromptLayout(block: Pick<PromptBlock, "block_id" | "prompt_text">): string[] {
  const errors: string[] = [];
  const text = block.prompt_text.trim();
  if (!text.startsWith("BEGIN PROMPT"))
    errors.push(`${label(block)}: prompt_text must start with "BEGIN PROMPT"`);
  if (!text.endsWith("END PROMPT"))
    errors.push(`${label(block)}: prompt_text must end with "END PROMPT"`);
  for (const marker of ["Staging:", "Opening frame:", "Audio:", "No subtitles."]) {
    if (!text.includes(marker)) errors.push(`${label(block)}: prompt_text is missing "${marker}"`);
  }
  return errors;
}

/** The owner's forbidden-word regex (`block` and `clip` are always forbidden). */
export const FORBIDDEN_PROMPT_WORDS =
  /\b(block|clip|previous|earlier|as before|same as|same position|continu\w*|still|last frame|next (?:block|clip|scene|shot)|returns? to)\b/gi;

/**
 * The forbidden-word regex over prompt_text, with the spoken dialogue lines removed first (a line
 * of the script may contain "still"; the line must stay word for word). Words found are listed
 * once each.
 */
export function checkForbiddenWords(
  block: Pick<PromptBlock, "block_id" | "prompt_text" | "shots">,
): string[] {
  let text = block.prompt_text;
  for (const shot of block.shots) {
    for (const d of shot.dialogue) {
      if (d.line.trim()) text = text.split(d.line.trim()).join(" ");
    }
  }
  const found = new Set<string>();
  for (const match of text.matchAll(FORBIDDEN_PROMPT_WORDS))
    found.add((match[0] ?? "").toLowerCase());
  return [...found].map(
    (word) =>
      `${label(block)}: prompt_text uses "${word}", which points outside the prompt or is forbidden`,
  );
}

/** 180 to 350 words, counted here (the `word_count` field is not trusted). */
export function checkWordCount(block: Pick<PromptBlock, "block_id" | "prompt_text">): string[] {
  const words = countWords(block.prompt_text);
  return words < 180 || words > 350
    ? [`${label(block)}: prompt_text has ${words} words; it must have 180 to 350`]
    : [];
}

/** Every shot has default_avoided; the block has both rationales. */
export function checkRationales(
  block: Pick<PromptBlock, "block_id" | "shots" | "camera_rationale" | "editing_rationale">,
): string[] {
  const errors: string[] = [];
  if (block.camera_rationale.trim() === "")
    errors.push(`${label(block)}: camera_rationale is empty`);
  if (block.editing_rationale.trim() === "")
    errors.push(`${label(block)}: editing_rationale is empty`);
  block.shots.forEach((shot, i) => {
    if (shot.default_avoided.trim() === "") {
      errors.push(`${label(block)} shot ${i + 1}: default_avoided is empty`);
    }
  });
  return errors;
}

/** Every character listed in assets.characters has a Staging entry in start_staging. */
export function checkOnScreenStaging(
  block: Pick<PromptBlock, "block_id" | "assets" | "start_staging">,
): string[] {
  const have = new Set(block.start_staging.map((s) => s.character_id));
  return block.assets.characters
    .filter((id) => !have.has(id))
    .map((id) => `${label(block)}: "${id}" is on screen but has no entry in start_staging`);
}

/**
 * v1.4: voices are not assets. No `voices` key anywhere and no `voice_` id (an exact id, or an
 * `@voice_` token in a prompt). `check()` gets the parsed answer, whose unknown keys (a `voices`
 * list) are already stripped and which structured output forbids anyway, so in practice this
 * catches `voice_` ids; the key check covers any raw value passed in.
 */
export function checkNoVoiceAssets(value: unknown): string[] {
  const errors = new Set<string>();
  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string") {
      // `voice_1`, `@voice_2`; not the heard_as value "voice_over".
      if (/^@?voice_[0-9]+$/.test(node.trim()) || /@voice_[0-9]/.test(node)) {
        errors.add(`${path}: voices are not assets; no "voice_" ids`);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, child] of Object.entries(node)) {
      const at = path ? `${path}.${key}` : key;
      if (key === "voices") errors.add(`${at}: voices are not assets; remove the voices list`);
      else walk(child, at);
    }
  };
  walk(value, "");
  return [...errors];
}

/** `@char_1` in the text, not as the start of `@char_10`. */
export function hasAssetToken(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escaped}(?![A-Za-z0-9_])`).test(text);
}

/**
 * v1.4 heard-only speakers: a character in `assets.heard_only` is not also in
 * `assets.characters`, has no `@id` token in prompt_text and no Staging entry; every dialogue
 * speaker is in the block's characters or heard_only (or is `new_char_`); `heard_as: on_screen`
 * only for a speaker in characters. A plan block (no shots, no prompt) gets the asset and Staging
 * parts.
 */
export function checkHeardOnly(
  block: Pick<PlanBlock, "block_id" | "assets" | "start_staging" | "end_staging"> & {
    shots?: readonly Shot[];
    prompt_text?: string;
  },
): string[] {
  const errors: string[] = [];
  const where = label(block);
  const onScreen = new Set(block.assets.characters);
  const heard = new Set(block.assets.heard_only);
  const staged = new Set([...block.start_staging, ...block.end_staging].map((s) => s.character_id));
  for (const id of heard) {
    if (onScreen.has(id)) {
      errors.push(`${where}: "${id}" is in both assets.characters and assets.heard_only`);
    }
    if (block.prompt_text !== undefined && hasAssetToken(block.prompt_text, id)) {
      errors.push(`${where}: "${id}" is heard only and must have no "@${id}" token in prompt_text`);
    }
    if (staged.has(id)) {
      errors.push(`${where}: "${id}" is heard only and must have no Staging entry`);
    }
  }
  const reported = new Set<string>();
  for (const shot of block.shots ?? []) {
    for (const d of shot.dialogue) {
      const id = d.speaker_id;
      const known = onScreen.has(id) || heard.has(id) || id.startsWith("new_char_");
      if (!known && !reported.has(id)) {
        reported.add(id);
        errors.push(
          `${where}: dialogue speaker "${id}" is in neither assets.characters nor assets.heard_only`,
        );
      }
      if (d.heard_as === "on_screen" && !onScreen.has(id)) {
        errors.push(
          `${where} window ${shot.window}: "${id}" is not in assets.characters, so heard_as cannot be "on_screen"`,
        );
      }
    }
  }
  return errors;
}

/** v1.4: a character's voice note is empty when output_21 says the character does not speak. */
export function checkVoiceNotes(bible: ContinuityBible, registry: AssetRegistry): string[] {
  const silent = new Set(registry.characters.filter((c) => !c.speaks).map((c) => c.char_id));
  return bible.characters
    .filter((c) => silent.has(c.asset_id) && c.voice.trim() !== "")
    .map(
      (c) =>
        `continuity_bible: "${c.asset_id}" does not speak (output_21 speaks false); its voice note must be empty`,
    );
}

/** applied_rules ids exist in the Creative Bible. */
export function checkAppliedRules(
  block: Pick<PromptBlock, "block_id" | "applied_rules">,
  ruleIds: ReadonlySet<string>,
): string[] {
  return block.applied_rules
    .filter((id) => !ruleIds.has(id))
    .map((id) => `${label(block)}: applied_rules "${id}" is not a rule of the Creative Bible`);
}

/**
 * continuity continuous|hard_cut: start_staging deep-equals the previous block's end_staging.
 * `previous` is the block before this one (null for the very first); a `first` or `new_scene`
 * block is not compared.
 */
export function checkStagingContinuity(
  block: Pick<PlanBlock, "block_id" | "start_staging" | "continuity">,
  previous: Pick<PlanBlock, "end_staging"> | null,
): string[] {
  const type = block.continuity.type;
  if (type !== "continuous" && type !== "hard_cut") return [];
  if (!previous) return [`${label(block)}: continuity "${type}" needs a previous block`];
  return stagingEqual(block.start_staging, previous.end_staging)
    ? []
    : [
        `${label(block)}: start_staging must equal the previous block's end_staging (continuity "${type}")`,
      ];
}

/**
 * Craft pipeline: a written block follows the Breakdown's shots exactly (tolerance 0). Its `shots`
 * are the planned windows in order, each window's seconds are the planned ones, and the k-th
 * planned shot is shot_number k (a shot with several windows repeats its number).
 */
export function checkShotPlanFollowed(
  block: Pick<PromptBlock, "block_id" | "shots">,
  planned: { shots: readonly Pick<PlannedShot, "shot_id" | "windows">[] } | undefined,
): string[] {
  if (!planned) return [`${label(block)}: the shot plan has no entry for this block`];
  const expected = planned.shots.flatMap((shot, i) =>
    shot.windows.map((w) => ({ shotId: shot.shot_id, number: i + 1, from: w.from_s, to: w.to_s })),
  );
  if (block.shots.length !== expected.length) {
    return [
      `${label(block)}: the shot plan has ${expected.length} windows (${planned.shots.map((s) => s.shot_id).join(", ")}), the block has ${block.shots.length}`,
    ];
  }
  const errors: string[] = [];
  block.shots.forEach((shot, i) => {
    const want = expected[i];
    if (!want) return;
    const where = `${label(block)} window ${i + 1}`;
    const got = parseWindow(shot.window);
    if (!got || got.from !== want.from || got.to !== want.to) {
      errors.push(
        `${where}: window must be "${want.from}-${want.to}s" (shot ${want.shotId} of the shot plan), not "${shot.window}"`,
      );
    }
    if (shot.shot_number !== want.number) {
      errors.push(
        `${where}: shot_number must be ${want.number} (shot ${want.shotId} of the shot plan), not ${shot.shot_number}`,
      );
    }
  });
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Script checks                                                               */
/* -------------------------------------------------------------------------- */

const norm = (text: string) => collapse(text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"'));

const HEADING_TEXT =
  /\b(?:INT|EXT|INT\.?\/EXT|EXT\.?\/INT|I\/E)\.?\s+[A-Z0-9][A-Z0-9 '.,/&()-]*?\s+-\s+[A-Z][A-Z ]*/g;

/**
 * script_coverage follows script order, as far as quotes can show it. Each block's start_quote is
 * found in the script after the previous block's start (in order); its end_quote is found
 * between its own start and the next block's start (so quotes cannot overlap or run backwards);
 * no more than ~8 words of script (scene headings aside) lie between one block's end and the
 * next block's start; the first block starts, and the last ends, within ~8 words of the script's
 * ends. "No gaps" cannot be proved from two quotes, hence the tolerance.
 */
export function checkScriptCoverage(
  blocks: readonly Pick<PlanBlock, "block_id" | "script_coverage">[],
  script: string,
  options: { first: boolean; last: boolean } = { first: true, last: true },
): string[] {
  const errors: string[] = [];
  const text = norm(script);
  const tolerance = 8;
  const gapWords = (from: number, to: number) =>
    countWords(text.slice(from, to).replace(HEADING_TEXT, " "));

  // Pass 1: where each block starts.
  const starts: number[] = [];
  let cursor = 0;
  for (const block of blocks) {
    const quote = norm(block.script_coverage.start_quote);
    const at = quote ? text.indexOf(quote, cursor) : -1;
    if (at < 0) {
      errors.push(
        `${label(block)}: start_quote is not in the script after the previous block's start (out of order, or not a script quote)`,
      );
      return errors;
    }
    starts.push(at);
    cursor = at + quote.length;
  }
  // Pass 2: where each block ends, and what lies between blocks.
  let previousEnd: number | null = null;
  blocks.forEach((block, i) => {
    const start = starts[i] ?? 0;
    const limit = i + 1 < blocks.length ? (starts[i + 1] ?? text.length) : text.length;
    const quote = norm(block.script_coverage.end_quote);
    const at = quote ? text.lastIndexOf(quote, limit - quote.length) : -1;
    if (at < start) {
      errors.push(
        `${label(block)}: end_quote is not in the script between its start_quote and the next block's start`,
      );
      return;
    }
    const gapFrom = previousEnd ?? 0;
    if ((previousEnd !== null || options.first) && gapWords(gapFrom, start) > tolerance) {
      errors.push(`${label(block)}: script text before this block is not covered by any block`);
    }
    previousEnd = at + quote.length;
  });
  if (options.last && previousEnd !== null && gapWords(previousEnd, text.length) > tolerance) {
    errors.push("the last block ends before the end of the script");
  }
  return errors;
}

/** Every dialogue line of every shot is a line of the script (no invented or reworded lines). */
export function checkDialogueInScript(
  block: Pick<PromptBlock, "block_id" | "shots">,
  script: string,
): string[] {
  const text = norm(script).toLowerCase();
  const errors: string[] = [];
  for (const shot of block.shots) {
    for (const d of shot.dialogue) {
      const line = norm(d.line).toLowerCase();
      if (line && !text.includes(line)) {
        errors.push(`${label(block)}: the dialogue "${d.line}" is not a line of the script`);
      }
    }
  }
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Whole-output checks                                                         */
/* -------------------------------------------------------------------------- */

/**
 * deviation_pct is at most 10 or a `runtime` warning exists; in a full or plan answer the totals
 * add up to the blocks.
 */
export function checkTotals(
  output: Pick<DirectorOutput, "totals" | "warnings"> & {
    blocks: readonly { duration_s: number }[];
  },
  options: { complete: boolean },
): string[] {
  const errors: string[] = [];
  const t = output.totals;
  if (options.complete) {
    const total = output.blocks.reduce((s, b) => s + b.duration_s, 0);
    if (t.block_count !== output.blocks.length)
      errors.push(`totals.block_count must be ${output.blocks.length}`);
    if (t.count_15 !== output.blocks.filter((b) => b.duration_s === 15).length) {
      errors.push("totals.count_15 does not match the blocks");
    }
    if (t.count_30 !== output.blocks.filter((b) => b.duration_s === 30).length) {
      errors.push("totals.count_30 does not match the blocks");
    }
    if (t.total_runtime_s !== total) errors.push(`totals.total_runtime_s must be ${total}`);
  }
  if (t.deviation_pct > 10 && !output.warnings.some((w) => w.type === "runtime")) {
    errors.push(
      `totals.deviation_pct is ${t.deviation_pct}: add a "runtime" warning or fit the runtime within 10%`,
    );
  }
  return errors;
}

/** Preflight: a rejected bible blocks; an open question is named in a warning; no-dialogue policy. */
export function checkPreflight(
  output: Pick<DirectorOutput, "status" | "warnings"> & { blocks: readonly { block_id: number }[] },
  bible: CreativeBible,
  hasDialogue: boolean,
): string[] {
  const errors: string[] = [];
  if (output.status === "blocked") {
    if (bible.validation_status !== "rejected") {
      errors.push(
        'status "blocked" is only for a Creative Bible whose validation_status is "rejected"',
      );
    }
    return errors;
  }
  if (bible.validation_status === "rejected") {
    errors.push(
      'the Creative Bible is "rejected": answer with status "blocked" and the reason in warnings',
    );
    return errors;
  }
  if (bible.validation_status === "needs_user_decision") {
    for (const q of bible.open_questions) {
      const named = output.warnings.some((w) => w.ref === q.id || w.message.includes(q.id));
      if (!named) errors.push(`open question "${q.id}" needs a warning that names it`);
    }
  }
  if (bible.project_frame.dialogue_policy === "none" && hasDialogue) {
    if (!output.warnings.some((w) => w.type === "dialogue_policy")) {
      errors.push(
        'dialogue_policy is "none" but the script has dialogue: add a "dialogue_policy" warning',
      );
    }
  }
  return errors;
}

type KnownAssets = ReadonlySet<string>;

function blockChecks(
  block: Block,
  ctx: {
    blockMode: BlockMode;
    platform: PlatformConfigInput;
    language: string | null;
    known: KnownAssets;
    ruleIds: ReadonlySet<string>;
    bible: ContinuityBible;
    script: string;
    allowedDurations: readonly number[];
  },
): string[] {
  return [
    ...checkDuration(block, ctx.blockMode, ctx.allowedDurations),
    ...checkShotWindows(block),
    ...checkShotBudget(block),
    ...checkBudgets(block, ctx.platform, ctx.language),
    ...checkAssetIds(block, ctx.known),
    ...checkDescriptors(block, ctx.bible),
    ...checkPromptLayout(block),
    ...checkForbiddenWords(block),
    ...checkWordCount(block),
    ...checkOnScreenStaging(block),
    ...checkHeardOnly(block),
    ...checkRationales(block),
    ...checkAppliedRules(block, ctx.ruleIds),
    ...checkDialogueInScript(block, ctx.script),
  ];
}

/**
 * The checks of `full` and `write_blocks`. For `write_blocks` the blocks are those of
 * `block_range`, the previous block of the first one is the plan's, and the bible and the planned
 * staging states must be the plan's.
 */
export function checkDirector(output: DirectorOutput, input: AnyDirectorInput): string[] {
  const bible = input.creative_bible;
  const preflight = checkPreflight(
    output,
    bible,
    output.blocks.some((b) => b.shots.some((s) => s.dialogue.length > 0)),
  );
  if (output.status === "blocked" || bible.validation_status === "rejected") return preflight;

  const errors = [...preflight];
  const known = registryAssetIds(input.asset_registry);
  const ctx = {
    blockMode: input.block_mode,
    platform: input.platform_config,
    language: bible.project_frame.script_language,
    known,
    ruleIds: bibleRuleIds(bible),
    bible: output.continuity_bible,
    script: input.script,
    allowedDurations: input.platform_config.block_length_options_sec,
  };
  errors.push(...checkBibleAssetIds(output.continuity_bible, known));
  errors.push(...checkVoiceNotes(output.continuity_bible, input.asset_registry));
  errors.push(...checkNoVoiceAssets(output));
  for (const id of output.directors_notes.rules_used) {
    if (!ctx.ruleIds.has(id))
      errors.push(`directors_notes.rules_used "${id}" is not a rule of the Creative Bible`);
  }

  const range =
    input.mode === "write_blocks" && input.block_range ? parseBlockRange(input.block_range) : null;
  const plan = input.plan;
  if (range) {
    const ids = output.blocks.map((b) => b.block_id);
    const expected = Array.from({ length: range.to - range.from + 1 }, (_, i) => range.from + i);
    if (!isDeepStrictEqual(ids, expected)) {
      errors.push(
        `write_blocks must return exactly the blocks ${range.from} to ${range.to}, in order`,
      );
    }
    if (plan && !isDeepStrictEqual(output.continuity_bible, plan.continuity_bible)) {
      errors.push("write_blocks must not change the continuity_bible of the plan");
    }
  } else {
    output.blocks.forEach((b, i) => {
      if (b.block_id !== i + 1)
        errors.push(
          `block numbers must run 1, 2, 3...: position ${i + 1} has block_id ${b.block_id}`,
        );
    });
  }
  const planById = new Map((plan?.blocks ?? []).map((b) => [b.block_id, b]));
  const shotPlan =
    range && input.shot_plan ? new Map(input.shot_plan.map((b) => [b.block_id, b])) : null;
  output.blocks.forEach((block, i) => {
    errors.push(...blockChecks(block, ctx));
    if (shotPlan) errors.push(...checkShotPlanFollowed(block, shotPlan.get(block.block_id)));
    const previous =
      i > 0 ? (output.blocks[i - 1] ?? null) : (planById.get(block.block_id - 1) ?? null);
    errors.push(...checkStagingContinuity(block, previous));
    const planned = range ? planById.get(block.block_id) : undefined;
    if (range && plan && !planned) errors.push(`${label(block)} is not in the plan`);
    if (planned) {
      if (
        !stagingEqual(block.start_staging, planned.start_staging) ||
        !stagingEqual(block.end_staging, planned.end_staging)
      ) {
        errors.push(`${label(block)}: the planned start_staging and end_staging must not change`);
      }
      if (block.duration_s !== planned.duration_s)
        errors.push(`${label(block)}: duration_s must be the plan's ${planned.duration_s}`);
    }
  });
  errors.push(
    ...checkScriptCoverage(output.blocks, input.script, {
      first: !range || range.from === 1,
      last: !range || (plan !== undefined && range.to >= plan.blocks.length),
    }),
  );
  errors.push(...checkTotals(output, { complete: !range }));
  return errors;
}

/** The plan-mode subset: no shots, prompt, words or dialogue; the rest of the owner's list. */
export function checkDirectorPlan(output: DirectorPlanOutput, input: AnyDirectorInput): string[] {
  const bible = input.creative_bible;
  const preflight = checkPreflight(output, bible, false);
  if (output.status === "blocked" || bible.validation_status === "rejected") return preflight;

  const errors = [...preflight];
  const known = registryAssetIds(input.asset_registry);
  const ruleIds = bibleRuleIds(bible);
  errors.push(...checkBibleAssetIds(output.continuity_bible, known));
  errors.push(...checkVoiceNotes(output.continuity_bible, input.asset_registry));
  errors.push(...checkNoVoiceAssets(output));
  for (const id of output.directors_notes.rules_used) {
    if (!ruleIds.has(id))
      errors.push(`directors_notes.rules_used "${id}" is not a rule of the Creative Bible`);
  }
  output.blocks.forEach((block, i) => {
    if (block.block_id !== i + 1)
      errors.push(
        `block numbers must run 1, 2, 3...: position ${i + 1} has block_id ${block.block_id}`,
      );
    errors.push(
      ...checkDuration(block, input.block_mode, input.platform_config.block_length_options_sec),
    );
    errors.push(...checkAssetIds(block, known));
    for (const id of [
      ...block.assets.characters,
      ...block.assets.locations,
      ...block.assets.props,
    ]) {
      if (descriptorFor(output.continuity_bible, id, block.block_id) === null) {
        errors.push(`${label(block)}: asset "${id}" has no entry in continuity_bible`);
      }
    }
    errors.push(...checkOnScreenStaging(block));
    errors.push(...checkHeardOnly(block));
    errors.push(...checkAppliedRules(block, ruleIds));
    errors.push(...checkStagingContinuity(block, i > 0 ? (output.blocks[i - 1] ?? null) : null));
    if (block.camera_rationale.trim() === "")
      errors.push(`${label(block)}: camera_rationale is empty`);
    if (block.editing_rationale.trim() === "")
      errors.push(`${label(block)}: editing_rationale is empty`);
    const max = input.platform_config.max_events_per_block[String(block.duration_s)];
    if (max !== undefined && block.budgets.events > max) {
      errors.push(
        `${label(block)}: ${block.budgets.events} events exceed max_events_per_block ${max}`,
      );
    }
  });
  errors.push(...checkScriptCoverage(output.blocks, input.script));
  errors.push(...checkTotals(output, { complete: true }));
  return errors;
}
