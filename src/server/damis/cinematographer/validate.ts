/**
 * The owner's `<code_side_validator>` for CINEMATOGRAPHER v1.0, as pure functions over the dami's
 * output and input.
 *
 * Interpretations (each noted where it applies):
 * - "No director field present" holds by construction: the structured-output schema has none.
 * - "No phrase contains a word from look_bible.forbidden_looks" is read as: no phrase contains a
 *   forbidden look (each entry as a whole phrase, e.g. "lens flares"); splitting entries into
 *   single words would forbid "lens" in every lens phrase.
 * - The brand list matches "RED" (the camera maker) only in capitals, so the colour red stays
 *   usable; every other brand matches in any case.
 * - Light setups must match a scene's location and time of day (`<process>` step 4), not only the
 *   location the validator names.
 */
import { countWords } from "../director/validate";
import { sceneRangeIds, type ShotV2 } from "../director-v2/schema";
import type {
  AnyCinematographerInput,
  CinematographerRelightInput,
  CinematographerShots,
  CinematographerShotsInput,
  CinematographerLookInput,
  CinematographerWarning,
  LightSetup,
  LookBible,
  LookOutput,
  RelightOutput,
} from "./schema";

/** The owner's word list for every phrase and line PROMPTER pastes. */
export const PHRASE_FORBIDDEN =
  /\b(previous|earlier|before|as before|same as|same position|continu\w*|still|again|last frame|next|returns? to|block|clip)\b/gi;
export const BARE_FOCAL_LENGTH = /\b\d{2,3}\s?mm\b/gi;
const BRANDS = /\b(arri|sony|canon|zeiss|cooke|panavision|leica|alexa)\b/gi;
const RED_BRAND = /\bRED\b/g;

function found(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map((m) => m[0] ?? ""))];
}

/** One pasteable phrase: word range, forbidden words, focal lengths, brands, forbidden looks. */
export function checkPhrase(
  where: string,
  phrase: string,
  range: readonly [number, number] | null,
  forbiddenLooks: readonly string[],
): string[] {
  const errors: string[] = [];
  if (range) {
    const words = countWords(phrase);
    if (words < range[0] || words > range[1]) {
      errors.push(`${where}: ${words} words; it must have ${range[0]} to ${range[1]}`);
    }
  }
  for (const w of found(phrase, PHRASE_FORBIDDEN)) {
    errors.push(`${where}: "${w}" points outside the prompt or is forbidden`);
  }
  for (const w of found(phrase, BARE_FOCAL_LENGTH)) {
    errors.push(
      `${where}: "${w}" is a bare focal length; write the lens feel and its visible effect`,
    );
  }
  for (const w of [...found(phrase, BRANDS), ...found(phrase, RED_BRAND)]) {
    errors.push(`${where}: "${w}" is a brand name`);
  }
  const lower = phrase.toLowerCase();
  for (const look of forbiddenLooks) {
    const l = look.trim().toLowerCase();
    if (l && lower.includes(l)) errors.push(`${where}: uses the forbidden look "${look}"`);
  }
  return errors;
}

export const LOOK_LINE_WORDS = [15, 40] as const;
export const LIGHT_LINE_WORDS = [10, 35] as const;
export const LENS_PHRASE_WORDS = [4, 14] as const;
export const CAMERA_PHRASE_WORDS = [6, 22] as const;
export const COMPOSITION_PHRASE_WORDS = [6, 22] as const;
export const LIGHT_ACCENT_WORDS = [0, 14] as const;

const norm = (s: string) => s.trim().toLowerCase();

/** A setup's light_line within 10–35 words and clean. */
function checkSetup(setup: LightSetup, forbidden: readonly string[]): string[] {
  return checkPhrase(
    `light_setups ${setup.light_id}: light_line`,
    setup.light_line,
    LIGHT_LINE_WORDS,
    forbidden,
  );
}

function preflight(
  out: { status: string; warnings: readonly CinematographerWarning[] },
  input: AnyCinematographerInput,
): string[] | null {
  const mustBlock =
    input.creative_bible.validation_status === "rejected" ||
    input.director_output.status === "blocked";
  if (out.status === "blocked") {
    return mustBlock
      ? []
      : ['status "blocked" is only for a rejected Creative Bible or a blocked director_output'];
  }
  if (mustBlock)
    return [
      'the Creative Bible is rejected or the director_output is blocked: answer with status "blocked"',
    ];
  return null;
}

function modeIs(out: { mode: string }, mode: string): string[] {
  return out.mode === mode ? [] : [`mode must be "${mode}"`];
}

/** Mode `look`. */
export function checkLook(out: LookOutput, input: CinematographerLookInput): string[] {
  const pre = preflight(out, input);
  if (pre) return pre;
  const errors = modeIs(out, "look");
  const bible: LookBible = out.look_bible;
  const forbidden = bible.forbidden_looks;
  errors.push(...checkPhrase("look_line", bible.look_line, LOOK_LINE_WORDS, forbidden));
  const ids = new Set<string>();
  for (const setup of bible.light_setups) {
    if (ids.has(setup.light_id))
      errors.push(`light_setups: light_id "${setup.light_id}" is used twice`);
    ids.add(setup.light_id);
    errors.push(...checkSetup(setup, forbidden));
  }
  for (const scene of input.director_output.scene_plan) {
    const has = bible.light_setups.some(
      (s) => s.location_id === scene.location_id && norm(s.time_of_day) === norm(scene.time_of_day),
    );
    if (!has) {
      errors.push(
        `light_setups: no setup for ${scene.location_id} at "${scene.time_of_day}" (${scene.scene_id})`,
      );
    }
  }
  bible.lens_language.forEach((l, i) =>
    errors.push(
      ...checkPhrase(`lens_language[${i}].phrase`, l.phrase, LENS_PHRASE_WORDS, forbidden),
    ),
  );
  bible.movement_language.forEach((m, i) =>
    errors.push(
      ...checkPhrase(`movement_language[${i}].phrase`, m.phrase, CAMERA_PHRASE_WORDS, forbidden),
    ),
  );
  return errors;
}

/** The director's shots of a `shots` call, in order. */
export function rangeShots(input: CinematographerShotsInput): ShotV2[] | null {
  const plan = input.director_output.scene_plan.map((s) => s.scene_id);
  const range = sceneRangeIds(input.scene_range, plan);
  return range ? input.director_output.shots.filter((s) => range.includes(s.scene_id)) : null;
}

/** Mode `shots`. */
export function checkCinematographerShots(
  out: CinematographerShots,
  input: CinematographerShotsInput,
): string[] {
  const pre = preflight(out, input);
  if (pre) return pre;
  const errors = modeIs(out, "shots");
  const director = rangeShots(input);
  if (!director)
    return [
      ...errors,
      `scene_range "${input.scene_range}" is not a range of the director's scenes`,
    ];
  const got = out.shots.map((s) => s.shot_id);
  const want = director.map((s) => s.shot_id);
  if (got.join("|") !== want.join("|")) {
    errors.push(`shots must be exactly the shot_ids of the range, in order: ${want.join(", ")}`);
  }
  const setups = new Map(input.look_bible.light_setups.map((s) => [s.light_id, s]));
  const forbidden = input.look_bible.forbidden_looks;
  const byId = new Map(out.shots.map((s) => [s.shot_id, s]));
  for (const shot of out.shots) {
    const d = director.find((x) => x.shot_id === shot.shot_id);
    const at = shot.shot_id;
    const setup = setups.get(shot.light_id);
    if (!setup) errors.push(`${at}: light_id "${shot.light_id}" is not in the look bible`);
    else if (d && setup.location_id !== d.location_id) {
      errors.push(
        `${at}: light_id "${shot.light_id}" lights ${setup.location_id}, not the shot's ${d.location_id}`,
      );
    }
    if (shot.lighting_change) {
      const to = setups.get(shot.lighting_change.to_light_id);
      if (!to)
        errors.push(
          `${at}: lighting_change.to_light_id "${shot.lighting_change.to_light_id}" is not in the look bible`,
        );
      else if (d && to.location_id !== d.location_id)
        errors.push(`${at}: lighting_change goes to another location's setup`);
    }
    if (
      d?.camera_move_intent === "static" &&
      (!["locked", "tripod"].includes(shot.support) || shot.speed !== "none")
    ) {
      errors.push(`${at}: a static shot needs support locked or tripod and speed "none"`);
    }
    errors.push(
      ...checkPhrase(`${at}: lens_phrase`, shot.phrases.lens_phrase, LENS_PHRASE_WORDS, forbidden),
    );
    errors.push(
      ...checkPhrase(
        `${at}: camera_phrase`,
        shot.phrases.camera_phrase,
        CAMERA_PHRASE_WORDS,
        forbidden,
      ),
    );
    errors.push(
      ...checkPhrase(
        `${at}: composition_phrase`,
        shot.phrases.composition_phrase,
        COMPOSITION_PHRASE_WORDS,
        forbidden,
      ),
    );
    errors.push(
      ...checkPhrase(
        `${at}: light_accent`,
        shot.phrases.light_accent,
        LIGHT_ACCENT_WORDS,
        forbidden,
      ),
    );
  }
  director.forEach((d, i) => {
    const next = director[i + 1];
    if (d.transition_after !== "continuous" || !next) return;
    const a = byId.get(d.shot_id);
    const b = byId.get(next.shot_id);
    if (!a || !b) return;
    for (const key of ["light_id", "lens_family", "dof", "support"] as const) {
      if (a[key] !== b[key])
        errors.push(`${d.shot_id} → ${next.shot_id}: a continuous take keeps the same ${key}`);
    }
  });
  for (const c of out.challenges) {
    if (!want.includes(c.shot_id))
      errors.push(`challenges: "${c.shot_id}" is not a shot of the range`);
  }
  return errors;
}

/** Mode `relight`. */
export function checkRelight(out: RelightOutput, input: CinematographerRelightInput): string[] {
  const pre = preflight(out, input);
  if (pre) return pre;
  const errors = modeIs(out, "relight");
  const location = input.location_sheet.location_id;
  if (out.location_id !== location) errors.push(`location_id must be "${location}"`);
  const known = new Map(input.look_bible.light_setups.map((s) => [s.light_id, s]));
  for (const setup of out.changed_setups) {
    const before = known.get(setup.light_id);
    if (!before)
      errors.push(`changed_setups: "${setup.light_id}" is not a setup of the look bible`);
    if (setup.location_id !== location)
      errors.push(`changed_setups: "${setup.light_id}" is not a setup of ${location}`);
    errors.push(...checkSetup(setup, input.look_bible.forbidden_looks));
  }
  const atLocation = new Set(
    input.director_output.shots.filter((s) => s.location_id === location).map((s) => s.shot_id),
  );
  for (const id of out.affected_shot_ids) {
    if (!atLocation.has(id)) errors.push(`affected_shot_ids: "${id}" is not a shot at ${location}`);
  }
  if (out.changed_setups.length > 0 && out.affected_shot_ids.length === 0) {
    errors.push("affected_shot_ids: list the shots that use the changed setups");
  }
  return errors;
}
