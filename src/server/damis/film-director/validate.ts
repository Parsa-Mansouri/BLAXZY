/**
 * The film-director's semantic checks (pure): what the JSON schema cannot say. Messages go back to
 * the model once, like schema errors.
 */
import { registryAssetIds, type AssetRegistry } from "../director/schema";
import { normalizeQuoteText } from "../shared/quotes";
import { isSceneHeading, splitLines } from "../shared/script-lines";
import type { FilmDirectorInput, FilmShot, ShotPlan } from "./schema";

/** A shot may run this long at most (one 30 second block). */
export const MAX_SHOT_SECONDS = 30;
/** Words of script that may lie uncovered between shots (cues, transitions, slug fragments). */
const COVERAGE_TOLERANCE_WORDS = 8;

const SHOT_ID = /^s([1-9][0-9]*)$/;

/** A provisional id the v1.4 Director also accepts for an asset missing from the registry. */
const isProvisional = (id: string) => id.startsWith("new_");

const known = (ids: ReadonlySet<string>, id: string) => ids.has(id) || isProvisional(id);

/** Lower-cased, with straight quotes and the shared Persian/Arabic and whitespace rules. */
const norm = (text: string) =>
  normalizeQuoteText(text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')).toLowerCase();

/* -------------------------------------------------------------------------- */
/* Ids                                                                         */
/* -------------------------------------------------------------------------- */

/** Shot ids are s1, s2, ... in order, each once. */
export function checkShotIds(shots: readonly Pick<FilmShot, "shot_id">[]): string[] {
  const errors: string[] = [];
  shots.forEach((shot, i) => {
    const match = SHOT_ID.exec(shot.shot_id);
    if (!match || Number(match[1]) !== i + 1) {
      errors.push(
        `shot ${i + 1}: shot_id "${shot.shot_id}" must be "s${i + 1}" (s1, s2... in order)`,
      );
    }
  });
  return errors;
}

export function checkDurations(
  shots: readonly Pick<FilmShot, "shot_id" | "duration_s">[],
): string[] {
  return shots
    .filter((s) => !(s.duration_s > 0 && s.duration_s <= MAX_SHOT_SECONDS))
    .map(
      (s) =>
        `${s.shot_id}: duration_s ${s.duration_s} must be above 0 and at most ${MAX_SHOT_SECONDS}`,
    );
}

/** `@char_1` style tokens in free text. */
const ASSET_TOKEN = /@((?:new_)?(?:char|loc|prop)_[0-9]+)(?![A-Za-z0-9_])/g;

/** Every string anywhere in `value`, with its path. */
function strings(value: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === "string") out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) strings(v, path ? `${path}.${k}` : k, out);
  }
}

/**
 * Every character, location and prop id the plan uses is in the asset registry (or a provisional
 * `new_` id): staging, sees, dialogue speakers, props and holders, geography, and every `@id`
 * token in free text.
 */
export function checkPlanAssetIds(plan: ShotPlan, registry: AssetRegistry): string[] {
  const ids = registryAssetIds(registry);
  const errors = new Set<string>();
  const need = (id: string, where: string) => {
    if (!known(ids, id)) errors.add(`${where}: "${id}" is not an id of the asset registry`);
  };
  for (const geo of plan.scene_geography) {
    need(geo.location_id, `scene_geography ${geo.scene_id} location_id`);
    for (const p of geo.starting_positions) need(p.character_id, `scene_geography ${geo.scene_id}`);
  }
  for (const shot of plan.shots) {
    for (const s of shot.staging) {
      need(s.character_id, `${shot.shot_id} staging`);
      for (const seen of s.sees) need(seen, `${shot.shot_id} staging sees`);
    }
    for (const d of shot.dialogue) need(d.speaker_id, `${shot.shot_id} dialogue speaker_id`);
    for (const p of shot.props) {
      need(p.prop_id, `${shot.shot_id} props`);
      if (p.holder_id !== null) need(p.holder_id, `${shot.shot_id} props holder_id`);
    }
  }
  const texts: { path: string; text: string }[] = [];
  strings(plan, "", texts);
  for (const { path, text } of texts) {
    for (const match of text.matchAll(ASSET_TOKEN)) {
      const id = match[1] ?? "";
      if (!known(ids, id)) errors.add(`${path}: @${id} is not an id of the asset registry`);
    }
  }
  return [...errors];
}

/** Scene and beat references hold together. */
export function checkScenesAndBeats(plan: ShotPlan): string[] {
  const errors: string[] = [];
  const scenes = new Set(plan.scene_geography.map((g) => g.scene_id));
  if (scenes.size !== plan.scene_geography.length) {
    errors.push("scene_geography lists a scene_id more than once");
  }
  const beats = new Set(plan.beats.map((b) => b.beat_id));
  if (beats.size !== plan.beats.length) errors.push("beats repeat a beat_id");
  for (const beat of plan.beats) {
    if (!scenes.has(beat.scene_id)) {
      errors.push(`beat ${beat.beat_id}: scene_id "${beat.scene_id}" has no scene_geography`);
    }
  }
  const covered = new Set<string>();
  for (const shot of plan.shots) {
    if (!scenes.has(shot.scene_id)) {
      errors.push(`${shot.shot_id}: scene_id "${shot.scene_id}" has no scene_geography`);
    }
    for (const id of shot.beat_ids) {
      if (!beats.has(id)) errors.push(`${shot.shot_id}: beat "${id}" is not in beats`);
      covered.add(id);
    }
  }
  for (const beat of plan.beats) {
    if (beat.must_survive && !covered.has(beat.beat_id)) {
      errors.push(`beat ${beat.beat_id} must survive but no shot plays it`);
    }
  }
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Script                                                                      */
/* -------------------------------------------------------------------------- */

/** Every dialogue line is a line of the script, word for word (normalised). */
export function checkPlanDialogue(shots: readonly FilmShot[], script: string): string[] {
  const text = norm(script);
  const errors: string[] = [];
  for (const shot of shots) {
    for (const d of shot.dialogue) {
      const line = norm(d.line);
      if (line && !text.includes(line)) {
        errors.push(`${shot.shot_id}: the dialogue "${d.line}" is not a line of the script`);
      }
    }
  }
  return errors;
}

type Word = { text: string; heading: boolean };

function scriptWords(script: string): Word[] {
  const out: Word[] = [];
  for (const line of splitLines(script)) {
    const heading = isSceneHeading(line);
    for (const w of norm(line).split(" ")) if (w) out.push({ text: w, heading });
  }
  return out;
}

function quoteWords(quote: string): string[] {
  return norm(quote)
    .split(" ")
    .filter((w) => w !== "");
}

function findWords(all: readonly Word[], needle: readonly string[], from: number): number {
  if (needle.length === 0) return -1;
  for (let i = Math.max(0, from); i + needle.length <= all.length; i++) {
    if (needle.every((w, j) => all[i + j]?.text === w)) return i;
  }
  return -1;
}

/**
 * The shots follow the script: each `script_quote.start` is found at or after the previous shot's
 * start (several shots may cover the same moment), each `end` at or after its own start, and no
 * more than a few words of script (scene headings aside) are left between the furthest point
 * covered so far and the next shot, or at either end of the script.
 */
export function checkPlanCoverage(
  shots: readonly Pick<FilmShot, "shot_id" | "script_quote">[],
  script: string,
): string[] {
  const all = scriptWords(script);
  const errors: string[] = [];
  const gap = (from: number, to: number) =>
    all.slice(from, to).filter((w) => !w.heading).length > COVERAGE_TOLERANCE_WORDS;
  let previousStart = 0;
  let coveredTo = 0;
  for (const shot of shots) {
    const startNeedle = quoteWords(shot.script_quote.start);
    const start = findWords(all, startNeedle, previousStart);
    if (start < 0) {
      errors.push(
        `${shot.shot_id}: script_quote.start is not in the script at or after the previous shot's start (out of order, or not a script quote)`,
      );
      return errors;
    }
    const endNeedle = quoteWords(shot.script_quote.end);
    const end = findWords(all, endNeedle, start);
    if (end < 0) {
      errors.push(`${shot.shot_id}: script_quote.end is not in the script after its start`);
      return errors;
    }
    if (gap(coveredTo, start)) {
      errors.push(`${shot.shot_id}: script text before this shot is not covered by any shot`);
    }
    previousStart = start;
    coveredTo = Math.max(coveredTo, end + endNeedle.length);
  }
  if (shots.length > 0 && gap(coveredTo, all.length)) {
    errors.push("the last shot ends before the end of the script");
  }
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Whole answers                                                               */
/* -------------------------------------------------------------------------- */

export function checkShotPlan(plan: ShotPlan, input: FilmDirectorInput): string[] {
  if (plan.status === "blocked") return [];
  return [
    ...checkShotIds(plan.shots),
    ...checkDurations(plan.shots),
    ...checkScenesAndBeats(plan),
    ...checkPlanAssetIds(plan, input.asset_registry),
    ...checkPlanDialogue(plan.shots, input.script),
    ...checkPlanCoverage(plan.shots, input.script),
    ...(plan.status === "ok_with_warnings" && plan.warnings.length === 0
      ? ["status ok_with_warnings needs at least one warning"]
      : []),
  ];
}
