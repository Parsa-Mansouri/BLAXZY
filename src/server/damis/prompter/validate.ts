/**
 * The owner's `<code_side_validator>` for PROMPTER v1.0, as pure functions over the dami's output
 * and input. Deliberate differences: the forbidden-word regex ignores spoken dialogue lines (a
 * script line may say "still"), as Director v1.4's does; "word_count within range" counts the
 * words itself and accepts an over-long unit only with status "over_length" and a warning (the
 * owner's `<writing_rules>`); each dialogue line must appear exactly once in quotes.
 */
import { countWords, FORBIDDEN_PROMPT_WORDS, hasAssetToken } from "../director/validate";
import { costumeDescriptorFor, type ShotV2 } from "../director-v2/schema";
import { parseUnitWindow, type BreakdownUnit } from "../breakdown/schema";
import type { DpShot } from "../cinematographer/schema";
import { promptWordRange } from "../shared/pipeline-platform";
import type { PrompterInput, PrompterOutput, PrompterUnit } from "./schema";

const count = (text: string, part: string) => (part ? text.split(part).length - 1 : 0);

/** What a unit is made of: its director and cinematographer shots, assets, lights and lines. */
export type UnitMaterial = {
  directorShots: ShotV2[];
  dpShots: DpShot[];
  characters: string[];
  locations: string[];
  props: string[];
  heardOnly: string[];
  lightIds: string[];
  lines: string[];
};

/** The unit's material, or the shot ids missing from the director or the cinematographer. */
export function unitMaterial(
  unit: BreakdownUnit,
  input: PrompterInput,
): UnitMaterial | { missing: string[] } {
  const missing: string[] = [];
  const directorShots: ShotV2[] = [];
  const dpShots: DpShot[] = [];
  for (const { shot_id } of unit.shots) {
    const d = input.director.shots.find((s) => s.shot_id === shot_id);
    const c = input.cinematographer.shots.find((s) => s.shot_id === shot_id);
    if (!d || !c) missing.push(shot_id);
    else {
      directorShots.push(d);
      dpShots.push(c);
    }
  }
  if (missing.length > 0) return { missing };
  const uniq = (xs: string[]) => [...new Set(xs)];
  const characters = uniq(directorShots.flatMap((s) => s.assets.characters));
  return {
    directorShots,
    dpShots,
    characters,
    locations: uniq(directorShots.map((s) => s.location_id)),
    props: uniq(directorShots.flatMap((s) => s.assets.props)),
    heardOnly: uniq(directorShots.flatMap((s) => s.assets.heard_only)).filter(
      (id) => !characters.includes(id),
    ),
    lightIds: uniq(
      dpShots.flatMap((s) => [
        s.light_id,
        ...(s.lighting_change ? [s.lighting_change.to_light_id] : []),
      ]),
    ),
    lines: directorShots
      .flatMap((s) => s.dialogue.map((d) => d.line.trim()))
      .filter((l) => l !== ""),
  };
}

/** The frozen texts the unit's prompt must carry verbatim. */
export function frozenTexts(
  unit: BreakdownUnit,
  m: UnitMaterial,
  input: PrompterInput,
): { label: string; text: string }[] {
  const bible = input.director.continuity_bible;
  const firstShot = unit.shots[0]?.shot_id ?? "";
  const out: { label: string; text: string }[] = [];
  for (const id of m.characters) {
    const d = costumeDescriptorFor(bible, id, firstShot, input.director.shots);
    if (d) out.push({ label: `the descriptor of ${id}`, text: d });
  }
  for (const id of m.locations) {
    const d = bible.locations.find((l) => l.asset_id === id)?.descriptor;
    if (d) out.push({ label: `the descriptor of ${id}`, text: d });
  }
  for (const id of m.props) {
    const d = bible.props.find((p) => p.asset_id === id)?.descriptor;
    if (d) out.push({ label: `the descriptor of ${id}`, text: d });
  }
  out.push({ label: "the look_line", text: input.cinematographer.look_bible.look_line });
  for (const id of m.lightIds) {
    const setup = input.cinematographer.look_bible.light_setups.find((s) => s.light_id === id);
    if (setup) out.push({ label: `the light_line of ${id}`, text: setup.light_line });
  }
  return out;
}

const WINDOW = /\[(\d+)-(\d+)s\]/g;

/** The checks of one written unit against its BREAKDOWN unit. */
export function checkPrompterUnit(
  written: PrompterUnit,
  unit: BreakdownUnit,
  input: PrompterInput,
): string[] {
  const at = `unit ${unit.unit_id}`;
  const m = unitMaterial(unit, input);
  if ("missing" in m) {
    return written.status === "skipped"
      ? []
      : [
          `${at}: shots ${m.missing.join(", ")} are missing from the director or cinematographer: skip the unit with a "missing_shot_data" warning`,
        ];
  }
  if (written.status === "skipped") {
    return written.warnings.length > 0
      ? []
      : [`${at}: a skipped unit needs a warning with the reason`];
  }
  const errors: string[] = [];
  const p = written.prompt_text;
  if (written.unit_type !== unit.unit_type)
    errors.push(`${at}: unit_type must be "${unit.unit_type}"`);
  if (written.duration_s !== unit.duration_s)
    errors.push(`${at}: duration_s must be ${unit.duration_s}`);
  if (written.generate_s !== unit.generate_s)
    errors.push(`${at}: generate_s must be ${unit.generate_s}`);
  if (!p.startsWith("BEGIN PROMPT"))
    errors.push(`${at}: prompt_text must start with "BEGIN PROMPT"`);
  if (!p.trimEnd().endsWith("END PROMPT"))
    errors.push(`${at}: prompt_text must end with "END PROMPT"`);
  for (const marker of [
    "Staging:",
    "Opening frame:",
    "Look:",
    "Audio:",
    "No subtitles.",
    "No text on screen.",
  ]) {
    if (!p.includes(marker)) errors.push(`${at}: prompt_text is missing "${marker}"`);
  }
  const windows = [...p.matchAll(WINDOW)].map((x) => `${x[1]}-${x[2]}s`);
  if (unit.unit_type === "block") {
    if (!p.includes("Shots:")) errors.push(`${at}: a block prompt needs "Shots:"`);
    const want = unit.shots.map((s) => s.window);
    if (windows.join("|") !== want.join("|")) {
      errors.push(
        `${at}: the shot windows must be BREAKDOWN's, one per shot: ${want.map((w) => `[${w}]`).join(" ")}`,
      );
    }
    const cuts = unit.shots.filter((s) => s.cut_in === "cut" || s.cut_in === "scene_cut").length;
    const noCuts = unit.shots.filter((s) => s.cut_in === "no_cut").length;
    if (count(p, "Cut to Shot") !== cuts)
      errors.push(`${at}: "Cut to Shot" must appear ${cuts} times`);
    if (count(p, "No cut —") !== noCuts)
      errors.push(`${at}: "No cut —" must appear ${noCuts} times`);
  } else {
    for (const marker of ["Shot:", "Action:", "No cuts."]) {
      if (!p.includes(marker)) errors.push(`${at}: a shot prompt needs "${marker}"`);
    }
    if (p.includes("Cut to")) errors.push(`${at}: a shot prompt has no "Cut to"`);
    let cursor = 0;
    let contiguous = windows.length > 0;
    for (const w of windows) {
      const parsed = parseUnitWindow(w);
      if (!parsed || parsed.from !== cursor || parsed.to <= parsed.from) contiguous = false;
      else cursor = parsed.to;
    }
    if (!contiguous || cursor !== unit.generate_s) {
      errors.push(`${at}: the Action windows must run from 0 to ${unit.generate_s} s with no gap`);
    }
  }
  for (const f of frozenTexts(unit, m, input)) {
    if (!p.includes(f.text)) errors.push(`${at}: prompt_text must contain ${f.label} verbatim`);
  }
  const tokens = new Set([...p.matchAll(/@([A-Za-z0-9_]+)/g)].map((x) => x[1] ?? ""));
  const want = new Set([...m.characters, ...m.locations, ...m.props]);
  for (const id of want) if (!hasAssetToken(p, id)) errors.push(`${at}: "@${id}" is missing`);
  for (const id of tokens) {
    if (!want.has(id)) {
      errors.push(
        m.heardOnly.includes(id)
          ? `${at}: "${id}" is heard only and gets no @ token`
          : `${at}: "@${id}" is not an on-screen asset of the unit`,
      );
    }
  }
  for (const line of m.lines) {
    const quoted = count(p, `"${line}"`) + count(p, `“${line}”`);
    if (quoted !== 1)
      errors.push(
        `${at}: the line "${line}" must appear exactly once, in quotes (found ${quoted})`,
      );
  }
  let scrubbed = p;
  for (const line of m.lines) scrubbed = scrubbed.split(line).join(" ");
  for (const w of new Set(
    [...scrubbed.matchAll(FORBIDDEN_PROMPT_WORDS)].map((x) => (x[0] ?? "").toLowerCase()),
  )) {
    errors.push(`${at}: prompt_text uses "${w}", which points outside the prompt or is forbidden`);
  }
  const words = countWords(p);
  const [min, max] = promptWordRange(input.platform_config, unit);
  if (words < min) errors.push(`${at}: prompt_text has ${words} words; it needs at least ${min}`);
  if (words > max) {
    const allowed =
      written.status === "over_length" && written.warnings.some((w) => w.type === "over_length");
    if (!allowed) {
      errors.push(
        `${at}: prompt_text has ${words} words, over ${max}: trim it, or return status "over_length" with a warning`,
      );
    }
  } else if (written.status === "over_length") {
    errors.push(`${at}: status "over_length" but the prompt is within ${max} words`);
  }
  return errors;
}

/** The whole answer: every input unit once, in order, each checked. */
export function checkPrompter(out: PrompterOutput, input: PrompterInput): string[] {
  const errors: string[] = [];
  const want = input.units.map((u) => u.unit_id);
  const got = out.units.map((u) => u.unit_id);
  if (want.join("|") !== got.join("|"))
    errors.push(`units must be exactly ${want.join(", ")}, in order`);
  for (const written of out.units) {
    const unit = input.units.find((u) => u.unit_id === written.unit_id);
    if (unit) errors.push(...checkPrompterUnit(written, unit, input));
  }
  const anyWarning = out.warnings.length > 0 || out.units.some((u) => u.warnings.length > 0);
  if (out.status === "ok_with_warnings" && !anyWarning)
    errors.push('status "ok_with_warnings" needs a warning');
  return errors;
}
