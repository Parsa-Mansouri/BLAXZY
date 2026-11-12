/**
 * The owner's runtime budget for the Script Writer (dami_script_writer_v0.2.md, section 0.1).
 * Code computes the budget and checks the result; the model never estimates runtime by feel.
 * Every number here is a tunable config value, not part of any prompt.
 */

/** Spoken dialogue, words per second. */
export const DIALOGUE_WORDS_PER_SECOND = 2.5;
/** Seconds per visible action beat (roughly one action sentence). */
export const SECONDS_PER_ACTION_BEAT = 3;
/** Seconds each scene change adds. */
export const SECONDS_PER_SCENE = 1;
/** The shortest piece the writer accepts. */
export const MIN_TARGET_SECONDS = 10;
/** Above this, one call loses continuity: the long pipeline (outline → segments) takes over. */
export const SINGLE_CALL_MAX_SECONDS = 15 * 60;
/** Beyond this, the owner recommends splitting into parts. */
export const HARD_MAX_SECONDS = 90 * 60;
/** Every outline sequence is this long at most. */
export const MAX_SEQUENCE_SECONDS = 8 * 60;

/** Dialogue share of the runtime, by the owner's genre name. */
export const DIALOGUE_SHARE: Readonly<Record<string, number>> = {
  Drama: 0.45,
  Comedy: 0.4,
  Thriller: 0.35,
  "Science Fiction": 0.35,
  Horror: 0.2,
  Action: 0.15,
};
/** Genres without a share of their own ("Other") use the middle of the range. */
export const DEFAULT_DIALOGUE_SHARE = 0.35;

export type DurationTier = "XS" | "S" | "M" | "L";

export type DurationBudget = {
  targetSeconds: number;
  tier: DurationTier;
  /** Null for tier L (the outline decides). */
  sceneCountRange: { min: number; max: number } | null;
  dialogueWordBudget: number;
  actionBeatBudget: number;
  toleranceSeconds: number;
};

export function dialogueShare(ownerGenre: string): number {
  return DIALOGUE_SHARE[ownerGenre] ?? DEFAULT_DIALOGUE_SHARE;
}

export function toleranceSeconds(targetSeconds: number): number {
  return Math.max(5, Math.round(0.1 * targetSeconds));
}

export function durationTier(targetSeconds: number): DurationTier {
  if (targetSeconds <= 90) return "XS";
  if (targetSeconds <= 300) return "S";
  if (targetSeconds <= SINGLE_CALL_MAX_SECONDS) return "M";
  return "L";
}

/** The owner's scene-count guide by runtime; null above 15 minutes. */
export function sceneCountRange(targetSeconds: number): { min: number; max: number } | null {
  if (targetSeconds <= 30) return { min: 1, max: 2 };
  if (targetSeconds <= 90) return { min: 1, max: 3 };
  if (targetSeconds <= 300) return { min: 2, max: 6 };
  if (targetSeconds <= SINGLE_CALL_MAX_SECONDS) return { min: 5, max: 15 };
  return null;
}

/** The budget sent to the writer as `duration_budget`. */
export function durationBudget(targetSeconds: number, ownerGenre: string): DurationBudget {
  const t = Math.max(MIN_TARGET_SECONDS, Math.round(targetSeconds));
  const share = dialogueShare(ownerGenre);
  return {
    targetSeconds: t,
    tier: durationTier(t),
    sceneCountRange: sceneCountRange(t),
    dialogueWordBudget: Math.round(t * share * DIALOGUE_WORDS_PER_SECOND),
    actionBeatBudget: Math.max(1, Math.round((t * (1 - share)) / SECONDS_PER_ACTION_BEAT)),
    toleranceSeconds: toleranceSeconds(t),
  };
}

/** What `estimate` counts in a screenplay (any shape with scenes of elements). */
export type EstimableScreenplay = {
  scenes: ReadonlyArray<{
    elements: ReadonlyArray<{ type: string; text?: string | null }>;
  }>;
};

export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/** Action beats in one action paragraph: its sentences (at least one). */
export function actionBeats(text: string): number {
  const sentences = text
    .split(/(?<=[.!?؟。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
  return Math.max(1, sentences.length);
}

export type RuntimeEstimate = {
  seconds: number;
  dialogueWords: number;
  actionBeats: number;
  scenes: number;
};

/** The owner's estimate: dialogue words / 2.5 + action beats × 3 + scenes × 1, rounded. */
export function estimate(screenplay: EstimableScreenplay): RuntimeEstimate {
  let dialogueWords = 0;
  let beats = 0;
  for (const scene of screenplay.scenes) {
    for (const element of scene.elements) {
      const text = element.text ?? "";
      if (element.type === "dialogue") dialogueWords += countWords(text);
      else if (element.type === "action" && text.trim()) beats += actionBeats(text);
    }
  }
  const scenes = screenplay.scenes.length;
  const seconds = Math.round(
    dialogueWords / DIALOGUE_WORDS_PER_SECOND +
      beats * SECONDS_PER_ACTION_BEAT +
      scenes * SECONDS_PER_SCENE,
  );
  return { seconds, dialogueWords, actionBeats: beats, scenes };
}

export type RuntimeVerdict = "ok" | "too_long" | "too_short";

export function runtimeVerdict(estimatedSeconds: number, targetSeconds: number): RuntimeVerdict {
  const tolerance = toleranceSeconds(targetSeconds);
  if (estimatedSeconds > targetSeconds + tolerance) return "too_long";
  if (estimatedSeconds < targetSeconds - tolerance) return "too_short";
  return "ok";
}

/** The owner's auto-correction note for a revise pass. */
export function runtimeCorrectionNote(estimatedSeconds: number, targetSeconds: number): string {
  const diff = Math.abs(estimatedSeconds - targetSeconds);
  const verb = estimatedSeconds > targetSeconds ? "Cut" : "Add";
  return `Runtime is ${estimatedSeconds}s, target ${targetSeconds}s. ${verb} about ${diff}s. Keep premise and ending.`;
}

/** "30s", "8 min", "1:45", "1 min 30 s", "90" (seconds) → seconds; null when unreadable. */
export function parseDurationText(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const clock = /^(\d+):([0-5]?\d)$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (/^\d+$/.test(t)) return Number(t);
  const minutes = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/.exec(t);
  const seconds = /(\d+)\s*(?:s|sec|secs|second|seconds)\b/.exec(t);
  if (!minutes && !seconds) return null;
  return Math.round((minutes ? Number(minutes[1]) * 60 : 0) + (seconds ? Number(seconds[1]) : 0));
}
