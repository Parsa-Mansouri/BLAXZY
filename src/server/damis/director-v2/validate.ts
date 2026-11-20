/**
 * The owner's `<code_side_validator>` for DIRECTOR v2.0, as pure functions over the dami's own
 * output and input. `checkDirectorV2*` compose them for each mode's `check()`.
 *
 * Added from the owner's `<process>` step 6 and `<modes>` (checkable, so checked): every shot has
 * `default_avoided`; a shot's location is its scene's; the scene's first and last staging are the
 * scene plan's; scene ends carry `scene_change` (and only the film's last shot `end`), because
 * BREAKDOWN splits runs on them; the totals add up; write_shots keeps to its scenes and its
 * scene-scoped ids; repair keeps dialogue and the scene's outer staging.
 *
 * Deliberate differences from the owner's text:
 * - The look-vocabulary scan skips spoken dialogue lines (a script line may say "lit"; lines stay
 *   word for word), as Director v1.4's forbidden-word check does.
 * - "Dialogue lines concatenated equal the script's lines" compares the spoken text of each scene
 *   (or of the whole script) as read by `scriptScenes`; when the script yields no speech in that
 *   layout, each line must be a line of the script, in order.
 */
import { bibleRuleIds, checkNoVoiceAssets, countWords } from "../director/validate";
import { registryAssetIds, type AssetRegistry } from "../director/schema";
import type { CreativeBible } from "../creative-dna/schema";
import {
  maxShotSeconds,
  wpsFor,
  type DeliveryMode,
  type PipelinePlatformConfig,
} from "../shared/pipeline-platform";
import {
  sceneRangeIds,
  targetRuntimeSeconds,
  type AnyDirectorV2Input,
  type ContinuityBibleV2,
  type DirectorV2Input,
  type DirectorV2Output,
  type DirectorV2PlanInput,
  type DirectorV2PlanOutput,
  type DirectorV2RepairInput,
  type DirectorV2RepairOutput,
  type DirectorV2ShotsInput,
  type DirectorV2ShotsOutput,
  type DirectorV2Totals,
  type DirectorV2Warning,
  type ScenePlanEntry,
  type ShotV2,
  type StagingState,
} from "./schema";
import { normalizeSpoken, scriptScenes, spokenText } from "./script";

/* -------------------------------------------------------------------------- */
/* Word lists                                                                  */
/* -------------------------------------------------------------------------- */

/** state_at_start / in_progress_at_end must not point outside the shot (owner's regex). */
export const OUTSIDE_REFERENCE =
  /\b(previous|earlier|as before|same as|same position|continu\w*|still|again|last frame|next (?:shot|scene))\b/gi;

/**
 * The owner's look vocabulary: no DIRECTOR field may use it (CINEMATOGRAPHER owns the look).
 * "mm" covers focal lengths written "35mm" or "35 mm".
 */
export const LOOK_VOCABULARY =
  /\b(lens(?:es)?|\d*\s?mm|grade|lighting|lit|glow\w*|grain\w*|bokeh|depth of field|colou?r grade|teal|amber|tungsten|anamorphic)\b/gi;

function matches(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map((m) => (m[0] ?? "").toLowerCase()))];
}

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

type CommonInput = Pick<
  AnyDirectorV2Input,
  "delivery_mode" | "platform_config" | "creative_bible" | "asset_registry" | "script"
>;

type ShotCtx = {
  deliveryMode: DeliveryMode;
  platform: PipelinePlatformConfig;
  wps: number;
  known: ReadonlySet<string>;
  staging: ReadonlyMap<string, StagingState>;
};

function shotCtx(input: CommonInput, staging: readonly StagingState[]): ShotCtx {
  return {
    deliveryMode: input.delivery_mode,
    platform: input.platform_config,
    wps: wpsFor(input.platform_config, input.creative_bible.project_frame.script_language),
    known: registryAssetIds(input.asset_registry),
    staging: new Map(staging.map((s) => [s.staging_id, s])),
  };
}

const isKnown = (id: string, known: ReadonlySet<string>) => known.has(id) || id.startsWith("new_");

/* -------------------------------------------------------------------------- */
/* One shot                                                                    */
/* -------------------------------------------------------------------------- */

/** The minimum spoken time: ceil(spoken_words / wps + 1). */
export function minSecondsForWords(words: number, wps: number): number {
  return Math.ceil(words / wps + 1);
}

/** The most words a shot of `idealS` may carry: floor(0.7 × ideal_s × wps). */
export function maxWordsForSeconds(idealS: number, wps: number): number {
  return Math.floor(0.7 * idealS * wps);
}

/** Timing: whole seconds, 1 ≤ min ≤ ideal ≤ max, the delivery mode's longest shot, speech fits. */
export function checkShotTiming(shot: ShotV2, ctx: ShotCtx): string[] {
  const errors: string[] = [];
  const at = shot.shot_id;
  const { min_s, ideal_s, max_s } = shot.duration;
  if (!(min_s >= 1 && min_s <= ideal_s && ideal_s <= max_s)) {
    errors.push(
      `${at}: duration must satisfy 1 ≤ min_s ≤ ideal_s ≤ max_s (${min_s}, ${ideal_s}, ${max_s})`,
    );
  }
  const limit = maxShotSeconds(ctx.deliveryMode);
  if (max_s > limit)
    errors.push(`${at}: max_s ${max_s} is over ${limit} s for ${ctx.deliveryMode}`);
  const words = shot.dialogue.reduce((s, d) => s + countWords(d.line), 0);
  if (shot.spoken_words !== words) {
    errors.push(`${at}: spoken_words is ${shot.spoken_words} but the dialogue has ${words} words`);
  }
  const minNeeded = minSecondsForWords(words, ctx.wps);
  if (min_s < minNeeded) {
    errors.push(
      `${at}: min_s ${min_s} is shorter than the spoken time; it must be at least ${minNeeded}`,
    );
  }
  const maxWords = maxWordsForSeconds(ideal_s, ctx.wps);
  if (words > maxWords) {
    errors.push(`${at}: ${words} spoken words exceed 70% of ideal_s (at most ${maxWords})`);
  }
  if (shot.events < 0) errors.push(`${at}: events must be 0 or more`);
  if (ctx.deliveryMode === "shot" && ideal_s < ctx.platform.unit_min_s) {
    if (!shot.rapid_cut || shot.trim_anchor === null) {
      errors.push(
        `${at}: ideal_s ${ideal_s} is under unit_min_s ${ctx.platform.unit_min_s}; that needs rapid_cut true and a trim_anchor`,
      );
    }
  }
  return errors;
}

/** Staging ids exist; on-screen characters have entries in the shot's start and end states. */
export function checkShotStaging(shot: ShotV2, ctx: ShotCtx): string[] {
  const errors: string[] = [];
  const states: StagingState[] = [];
  for (const id of [shot.staging_start_id, shot.staging_end_id]) {
    const state = ctx.staging.get(id);
    if (!state) errors.push(`${shot.shot_id}: staging id "${id}" is not in staging_states`);
    else states.push(state);
  }
  for (const state of states) {
    const staged = new Set(state.entries.map((e) => e.character_id));
    for (const id of shot.assets.characters) {
      if (!staged.has(id)) {
        errors.push(
          `${shot.shot_id}: "${id}" is on screen but has no entry in staging "${state.staging_id}"`,
        );
      }
    }
  }
  return errors;
}

/** Speakers, heard_as, asset ids, self-contained states, default_avoided. */
export function checkShotContent(shot: ShotV2, ctx: ShotCtx): string[] {
  const errors: string[] = [];
  const at = shot.shot_id;
  const onScreen = new Set(shot.assets.characters);
  const heard = new Set(shot.assets.heard_only);
  for (const id of heard) {
    if (onScreen.has(id))
      errors.push(`${at}: "${id}" is in both assets.characters and assets.heard_only`);
  }
  for (const d of shot.dialogue) {
    if (!onScreen.has(d.speaker_id) && !heard.has(d.speaker_id)) {
      errors.push(
        `${at}: speaker "${d.speaker_id}" is in neither assets.characters nor assets.heard_only`,
      );
    }
    if (d.heard_as === "on_screen" && !onScreen.has(d.speaker_id)) {
      errors.push(
        `${at}: heard_as "on_screen" is only for a speaker in assets.characters ("${d.speaker_id}")`,
      );
    }
  }
  const ids = [
    ...shot.assets.characters,
    ...shot.assets.props,
    ...shot.assets.heard_only,
    shot.location_id,
    ...(shot.owner.trim() ? [shot.owner] : []),
  ];
  for (const id of new Set(ids)) {
    if (!isKnown(id, ctx.known))
      errors.push(`${at}: asset_id "${id}" is not in output_21 and does not start with "new_"`);
  }
  for (const field of ["state_at_start", "in_progress_at_end"] as const) {
    for (const word of matches(shot[field], OUTSIDE_REFERENCE)) {
      errors.push(
        `${at}: ${field} uses "${word}"; write it as present fact for someone who has seen nothing`,
      );
    }
  }
  if (shot.default_avoided.trim() === "") errors.push(`${at}: default_avoided is empty`);
  return errors;
}

/* -------------------------------------------------------------------------- */
/* A scene's shots                                                             */
/* -------------------------------------------------------------------------- */

/** Σ(max_s − min_s) ≥ max(3, 0.2 × Σ ideal_s) for one scene's shots. */
export function checkSceneFlex(sceneId: string, shots: readonly ShotV2[]): string[] {
  const flex = shots.reduce((s, x) => s + (x.duration.max_s - x.duration.min_s), 0);
  const ideal = shots.reduce((s, x) => s + x.duration.ideal_s, 0);
  const need = Math.max(3, 0.2 * ideal);
  return flex < need
    ? [
        `${sceneId}: the shots' flexibility Σ(max_s − min_s) is ${flex} s; it must be at least ${Math.ceil(need)} s`,
      ]
    : [];
}

/**
 * One scene's shots in order: staging chains (unless a time_jump), continuous takes keep size,
 * angle and move intent, the scene ends on scene_change (end for the film's last scene), its
 * location and outer staging are the plan's.
 */
export function checkSceneShots(
  sceneId: string,
  shots: readonly ShotV2[],
  options: {
    plan: ScenePlanEntry | undefined;
    lastScene: boolean;
    outer?: { start: string; end: string };
  },
): string[] {
  const errors: string[] = [];
  shots.forEach((shot, i) => {
    const next = shots[i + 1];
    const previous = shots[i - 1];
    if (
      previous &&
      previous.transition_after !== "time_jump" &&
      shot.staging_start_id !== previous.staging_end_id
    ) {
      errors.push(
        `${shot.shot_id}: staging_start_id "${shot.staging_start_id}" must equal the shot before's staging_end_id "${previous.staging_end_id}"`,
      );
    }
    if (shot.transition_after === "continuous") {
      if (!next) {
        errors.push(
          `${shot.shot_id}: transition_after "continuous" needs a next shot in the same scene`,
        );
      } else if (
        next.size !== shot.size ||
        next.angle !== shot.angle ||
        next.camera_move_intent !== shot.camera_move_intent
      ) {
        errors.push(
          `${shot.shot_id} → ${next.shot_id}: a continuous take keeps the same size, angle and camera_move_intent`,
        );
      }
    }
    if (next && (shot.transition_after === "scene_change" || shot.transition_after === "end")) {
      errors.push(
        `${shot.shot_id}: "${shot.transition_after}" is only for the last shot of a scene`,
      );
    }
    if (options.plan && shot.location_id !== options.plan.location_id) {
      errors.push(
        `${shot.shot_id}: location_id "${shot.location_id}" is not the scene's "${options.plan.location_id}"`,
      );
    }
  });
  const last = shots[shots.length - 1];
  if (last) {
    const want = options.lastScene ? "end" : "scene_change";
    if (last.transition_after !== want) {
      errors.push(`${last.shot_id}: the last shot of ${sceneId} needs transition_after "${want}"`);
    }
  }
  const outer =
    options.outer ??
    (options.plan
      ? { start: options.plan.start_staging_id, end: options.plan.end_staging_id }
      : null);
  const first = shots[0];
  if (outer && first && last) {
    if (first.staging_start_id !== outer.start) {
      errors.push(`${sceneId}: the first shot must start on staging "${outer.start}"`);
    }
    if (last.staging_end_id !== outer.end) {
      errors.push(`${sceneId}: the last shot must end on staging "${outer.end}"`);
    }
  }
  errors.push(...checkSceneFlex(sceneId, shots));
  return errors;
}

/** Each shot's own checks, plus unique ids. */
function checkShots(shots: readonly ShotV2[], ctx: ShotCtx): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const shot of shots) {
    if (seen.has(shot.shot_id)) errors.push(`shot_id "${shot.shot_id}" is used twice`);
    seen.add(shot.shot_id);
    errors.push(
      ...checkShotTiming(shot, ctx),
      ...checkShotStaging(shot, ctx),
      ...checkShotContent(shot, ctx),
    );
  }
  return errors;
}

/** `order` runs 1, 2, 3 … in list order. */
function checkOrder(shots: readonly ShotV2[]): string[] {
  const errors: string[] = [];
  shots.forEach((shot, i) => {
    if (shot.order !== i + 1)
      errors.push(`${shot.shot_id}: order must be ${i + 1} (shots in order, contiguous)`);
  });
  return errors;
}

/**
 * Shots grouped by scene, scenes in `sceneIds` order, each with at least one shot. Errors for a
 * scene outside the list, a scene whose shots are not together, or one out of order.
 */
function groupByScene(
  shots: readonly ShotV2[],
  sceneIds: readonly string[],
): { groups: Map<string, ShotV2[]>; errors: string[] } {
  const errors: string[] = [];
  const groups = new Map<string, ShotV2[]>(sceneIds.map((id) => [id, []]));
  let position = 0;
  for (const shot of shots) {
    const index = sceneIds.indexOf(shot.scene_id);
    if (index < 0) {
      errors.push(
        `${shot.shot_id}: scene_id "${shot.scene_id}" is not one of ${sceneIds.join(", ")}`,
      );
      continue;
    }
    if (index < position)
      errors.push(
        `${shot.shot_id}: shots must follow the scene order (${shot.scene_id} after a later scene)`,
      );
    position = Math.max(position, index);
    groups.get(shot.scene_id)?.push(shot);
  }
  for (const [id, list] of groups) if (list.length === 0) errors.push(`${id} has no shot`);
  return { groups, errors };
}

/* -------------------------------------------------------------------------- */
/* Dialogue against the script                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The shots' dialogue, joined, equals the script's spoken text (of the scenes `sceneIndexes`, or
 * the whole script). When the script yields no speech in this layout: every line is in the script,
 * in order.
 */
export function checkDialogueMatchesScript(
  shots: readonly Pick<ShotV2, "shot_id" | "dialogue">[],
  script: string,
  sceneIndexes: readonly number[] | null,
): string[] {
  const scenes = scriptScenes(script);
  const chosen = sceneIndexes
    ? sceneIndexes.map((i) => scenes[i]).filter((s) => s !== undefined)
    : scenes;
  const expected = spokenText(chosen.flatMap((s) => s.speeches.map((x) => x.line)));
  const lines = shots.flatMap((s) => s.dialogue.map((d) => d.line));
  const actual = spokenText(lines);
  if (expected !== "") {
    if (actual === expected) return [];
    return [
      "the dialogue lines, in order, must be exactly the script's spoken lines (no line missing, added, repeated, reordered or reworded)",
    ];
  }
  const text = normalizeSpoken(script);
  const errors: string[] = [];
  let cursor = 0;
  for (const shot of shots) {
    for (const d of shot.dialogue) {
      const line = normalizeSpoken(d.line);
      const at = text.indexOf(line, cursor);
      if (at < 0) {
        errors.push(
          `${shot.shot_id}: "${d.line}" is not a line of the script at this point (in order)`,
        );
      } else {
        cursor = at + line.length;
      }
    }
  }
  return errors;
}

/** Script scene indexes of plan scene ids, when the script's headings line up with the plan. */
function scriptIndexesFor(
  script: string,
  planSceneIds: readonly string[],
  wanted: readonly string[],
): number[] | null {
  const scenes = scriptScenes(script);
  if (scenes.length !== planSceneIds.length) return null;
  return wanted.map((id) => planSceneIds.indexOf(id));
}

/* -------------------------------------------------------------------------- */
/* Whole-output checks                                                         */
/* -------------------------------------------------------------------------- */

/**
 * No field uses the look vocabulary (dialogue lines aside). Walks every string of the value with
 * its path; keys named `line` under `dialogue` are skipped.
 */
export function checkLookVocabulary(value: unknown): string[] {
  const errors = new Set<string>();
  const walk = (node: unknown, path: string, inDialogue: boolean): void => {
    if (typeof node === "string") {
      for (const word of matches(node, LOOK_VOCABULARY)) {
        errors.add(
          `${path}: "${word}" is look vocabulary; light, colour, lens and texture belong to CINEMATOGRAPHER`,
        );
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`, inDialogue));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, child] of Object.entries(node)) {
      if (inDialogue && key === "line") continue;
      walk(child, path ? `${path}.${key}` : key, key === "dialogue" || inDialogue);
    }
  };
  walk(value, "", false);
  return [...errors];
}

/** Preflight: a rejected bible blocks; open questions are named; a no-dialogue policy is warned. */
export function checkPreflightV2(
  output: { status: string; warnings: readonly DirectorV2Warning[] },
  bible: CreativeBible,
  hasDialogue: boolean,
): string[] {
  if (output.status === "blocked") {
    return bible.validation_status === "rejected"
      ? []
      : ['status "blocked" is only for a Creative Bible whose validation_status is "rejected"'];
  }
  if (bible.validation_status === "rejected") {
    return [
      'the Creative Bible is "rejected": answer with status "blocked" and the reason in warnings',
    ];
  }
  const errors: string[] = [];
  if (bible.validation_status === "needs_user_decision") {
    for (const q of bible.open_questions) {
      if (!output.warnings.some((w) => w.ref === q.id || w.message.includes(q.id))) {
        errors.push(`open question "${q.id}" needs a warning that names it`);
      }
    }
  }
  if (
    bible.project_frame.dialogue_policy === "none" &&
    hasDialogue &&
    !output.warnings.some((w) => w.type === "dialogue_policy")
  ) {
    errors.push(
      'dialogue_policy is "none" but the script has dialogue: add a "dialogue_policy" warning',
    );
  }
  if (output.status === "ok_with_warnings" && output.warnings.length === 0) {
    errors.push('status "ok_with_warnings" needs at least one warning');
  }
  return errors;
}

/** Bible ids exist (or are `new_`), silent characters have no voice note, rules exist. */
function checkBible(
  bible: ContinuityBibleV2,
  registry: AssetRegistry,
  known: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const id of [...bible.characters, ...bible.locations, ...bible.props].map(
    (a) => a.asset_id,
  )) {
    if (!isKnown(id, known))
      errors.push(
        `continuity_bible: asset_id "${id}" is not in output_21 and does not start with "new_"`,
      );
  }
  const silent = new Set(registry.characters.filter((c) => !c.speaks).map((c) => c.char_id));
  for (const c of bible.characters) {
    if (silent.has(c.asset_id) && c.voice.trim() !== "") {
      errors.push(
        `continuity_bible: "${c.asset_id}" does not speak (output_21 speaks false); its voice must be empty`,
      );
    }
  }
  return errors;
}

function checkRules(ids: readonly string[], where: string, ruleIds: ReadonlySet<string>): string[] {
  return ids
    .filter((id) => !ruleIds.has(id))
    .map((id) => `${where}: "${id}" is not a rule of the Creative Bible`);
}

/** The plan part (full and plan modes): scene plan, staging states, bible, notes, project. */
function checkPlanPart(
  out: Pick<
    DirectorV2PlanOutput,
    | "project"
    | "dramatic_analysis"
    | "directors_notes"
    | "continuity_bible"
    | "scene_plan"
    | "staging_states"
  >,
  input: CommonInput,
  costumeRefs: "shots" | "scenes",
  shotIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  const known = registryAssetIds(input.asset_registry);
  if (out.project.delivery_mode !== input.delivery_mode) {
    errors.push(`project.delivery_mode must be "${input.delivery_mode}"`);
  }
  const planIds = out.scene_plan.map((s) => s.scene_id);
  const analysisIds = out.dramatic_analysis.scenes.map((s) => s.scene_id);
  if (planIds.join("|") !== analysisIds.join("|")) {
    errors.push(
      "scene_plan and dramatic_analysis.scenes must list the same scenes in the same order",
    );
  }
  if (new Set(planIds).size !== planIds.length) errors.push("scene_plan has a scene_id twice");
  const stagingIds = new Set<string>();
  for (const state of out.staging_states) {
    if (stagingIds.has(state.staging_id))
      errors.push(`staging_id "${state.staging_id}" is used twice`);
    stagingIds.add(state.staging_id);
    for (const e of state.entries) {
      if (!isKnown(e.character_id, known))
        errors.push(`${state.staging_id}: character "${e.character_id}" is not in output_21`);
    }
  }
  for (const scene of out.scene_plan) {
    for (const id of [scene.start_staging_id, scene.end_staging_id]) {
      if (!stagingIds.has(id))
        errors.push(`${scene.scene_id}: staging "${id}" is not in staging_states`);
    }
    if (!isKnown(scene.location_id, known))
      errors.push(`${scene.scene_id}: location_id "${scene.location_id}" is not in output_21`);
    if (scene.target_ideal_s < 1)
      errors.push(`${scene.scene_id}: target_ideal_s must be at least 1`);
  }
  errors.push(...checkBible(out.continuity_bible, input.asset_registry, known));
  for (const c of out.continuity_bible.characters) {
    for (const v of c.costume_versions) {
      const ok = costumeRefs === "shots" ? shotIds.has(v.from_shot) : planIds.includes(v.from_shot);
      if (!ok) {
        errors.push(
          `continuity_bible: "${c.asset_id}" costume version from_shot "${v.from_shot}" is not ${costumeRefs === "shots" ? "a shot_id" : "a scene_id of the plan"}`,
        );
      }
    }
  }
  const ruleIds = bibleRuleIds(input.creative_bible);
  errors.push(...checkRules(out.directors_notes.rules_used, "directors_notes.rules_used", ruleIds));
  for (const o of out.directors_notes.aesthetic_overrides) {
    if (o.rule_id && !ruleIds.has(o.rule_id))
      errors.push(`aesthetic_overrides: "${o.rule_id}" is not a rule of the Creative Bible`);
  }
  return errors;
}

/** The runtime check: deviation within 10%, or a runtime warning. */
function checkRuntime(
  ideal: number,
  target: number | null,
  warnings: readonly DirectorV2Warning[],
  tolerancePct: number,
): string[] {
  if (!target) return [];
  const deviation = (Math.abs(ideal - target) / target) * 100;
  return deviation > tolerancePct && !warnings.some((w) => w.type === "runtime")
    ? [
        `the ideal runtime ${ideal} s is ${deviation.toFixed(1)}% from the target ${target} s: fit it within ${tolerancePct}% or add a "runtime" warning`,
      ]
    : [];
}

/** The totals of a shot list (what `totals` must say). */
export function computeTotals(shots: readonly ShotV2[], target: number | null): DirectorV2Totals {
  const sum = (f: (s: ShotV2) => number) => shots.reduce((a, s) => a + f(s), 0);
  const ideal = sum((s) => s.duration.ideal_s);
  const targetS = target ?? 0;
  return {
    shot_count: shots.length,
    min_runtime_s: sum((s) => s.duration.min_s),
    ideal_runtime_s: ideal,
    max_runtime_s: sum((s) => s.duration.max_s),
    target_runtime_s: targetS,
    deviation_pct: targetS > 0 ? Math.round((Math.abs(ideal - targetS) / targetS) * 1000) / 10 : 0,
  };
}

function checkTotalsV2(out: DirectorV2Output, target: number | null): string[] {
  const want = computeTotals(out.shots, target);
  const t = out.totals;
  const errors: string[] = [];
  for (const key of ["shot_count", "min_runtime_s", "ideal_runtime_s", "max_runtime_s"] as const) {
    if (t[key] !== want[key]) errors.push(`totals.${key} must be ${want[key]}`);
  }
  if (target !== null) {
    if (t.target_runtime_s !== target) errors.push(`totals.target_runtime_s must be ${target}`);
    if (Math.abs(t.deviation_pct - want.deviation_pct) > 1)
      errors.push(`totals.deviation_pct must be ${want.deviation_pct}`);
  }
  if (t.deviation_pct > 10 && !out.warnings.some((w) => w.type === "runtime")) {
    errors.push(
      `totals.deviation_pct is ${t.deviation_pct}: add a "runtime" warning or fit the runtime within 10%`,
    );
  }
  return errors;
}

/** The shots of a set of scenes against their plan entries (full and write_shots). */
function checkScenes(
  shots: readonly ShotV2[],
  sceneIds: readonly string[],
  scenePlan: readonly ScenePlanEntry[],
  ctx: ShotCtx,
): string[] {
  const { groups, errors } = groupByScene(shots, sceneIds);
  const lastSceneId = scenePlan[scenePlan.length - 1]?.scene_id;
  for (const [sceneId, list] of groups) {
    if (list.length === 0) continue;
    errors.push(
      ...checkSceneShots(sceneId, list, {
        plan: scenePlan.find((s) => s.scene_id === sceneId),
        lastScene: sceneId === lastSceneId,
      }),
    );
  }
  errors.push(...checkShots(shots, ctx));
  return errors;
}

function modeIs(out: { mode: string }, mode: string): string[] {
  return out.mode === mode ? [] : [`mode must be "${mode}"`];
}

/* -------------------------------------------------------------------------- */
/* Per mode                                                                    */
/* -------------------------------------------------------------------------- */

/** Mode `full`: the whole output_22_dir. */
export function checkDirectorV2(out: DirectorV2Output, input: DirectorV2Input): string[] {
  const hasDialogue = out.shots.some((s) => s.dialogue.length > 0);
  const preflight = checkPreflightV2(out, input.creative_bible, hasDialogue);
  if (out.status === "blocked" || input.creative_bible.validation_status === "rejected")
    return preflight;
  const errors = [...modeIs(out, "full"), ...preflight];
  errors.push(...checkPlanPart(out, input, "shots", new Set(out.shots.map((s) => s.shot_id))));
  const ctx = shotCtx(input, out.staging_states);
  errors.push(...checkOrder(out.shots));
  errors.push(
    ...checkScenes(
      out.shots,
      out.scene_plan.map((s) => s.scene_id),
      out.scene_plan,
      ctx,
    ),
  );
  const ruleIds = bibleRuleIds(input.creative_bible);
  for (const s of out.shots)
    errors.push(...checkRules(s.applied_rules, `${s.shot_id}: applied_rules`, ruleIds));
  errors.push(...checkDialogueMatchesScript(out.shots, input.script, null));
  errors.push(...checkNoVoiceAssets(out));
  errors.push(...checkLookVocabulary(out));
  errors.push(...checkTotalsV2(out, targetRuntimeSeconds(input.creative_bible.project_frame)));
  return errors;
}

/** Mode `plan`: no shots; the scene plan's targets carry the runtime. */
export function checkDirectorV2Plan(
  out: DirectorV2PlanOutput,
  input: DirectorV2PlanInput,
): string[] {
  const preflight = checkPreflightV2(out, input.creative_bible, false);
  if (out.status === "blocked" || input.creative_bible.validation_status === "rejected")
    return preflight;
  const errors = [...modeIs(out, "plan"), ...preflight];
  errors.push(...checkPlanPart(out, input, "scenes", new Set()));
  const ideal = out.scene_plan.reduce((s, x) => s + x.target_ideal_s, 0);
  errors.push(
    ...checkRuntime(
      ideal,
      targetRuntimeSeconds(input.creative_bible.project_frame),
      out.warnings,
      input.platform_config.runtime_tolerance_pct,
    ),
  );
  errors.push(...checkNoVoiceAssets(out));
  errors.push(...checkLookVocabulary(out));
  return errors;
}

/** Scene-scoped shot ids of write_shots: `sh_<scene number>_<index>`. */
export function sceneScopedShotId(shotId: string, sceneId: string): boolean {
  const n = /^sc_(\d+)$/.exec(sceneId)?.[1];
  return n !== undefined && new RegExp(`^sh_${n}_\\d{2,}[a-z]*$`).test(shotId);
}

/** Mode `write_shots`: the scenes of the range, on the plan's staging and locations. */
export function checkDirectorV2Shots(
  out: DirectorV2ShotsOutput,
  input: DirectorV2ShotsInput,
): string[] {
  const hasDialogue = out.shots.some((s) => s.dialogue.length > 0);
  const preflight = checkPreflightV2(out, input.creative_bible, hasDialogue);
  if (out.status === "blocked" || input.creative_bible.validation_status === "rejected")
    return preflight;
  const errors = [...modeIs(out, "write_shots"), ...preflight];
  const plan = input.plan;
  const planSceneIds = plan.scene_plan.map((s) => s.scene_id);
  const range = sceneRangeIds(input.scene_range, planSceneIds);
  if (!range)
    return [...errors, `scene_range "${input.scene_range}" is not a range of the plan's scenes`];
  const planStaging = new Set(plan.staging_states.map((s) => s.staging_id));
  for (const state of out.staging_states) {
    if (planStaging.has(state.staging_id)) {
      errors.push(
        `staging_states: "${state.staging_id}" is the plan's; return only the states this batch adds`,
      );
    }
    if (!range.includes(state.scene_id))
      errors.push(
        `staging_states: "${state.staging_id}" belongs to ${state.scene_id}, outside the range`,
      );
  }
  const ctx = shotCtx(input, [...plan.staging_states, ...out.staging_states]);
  errors.push(...checkOrder(out.shots));
  for (const shot of out.shots) {
    if (!sceneScopedShotId(shot.shot_id, shot.scene_id)) {
      errors.push(
        `${shot.shot_id}: in write_shots a shot id is scene-scoped, sh_<scene number>_<two-digit index>`,
      );
    }
  }
  errors.push(...checkScenes(out.shots, range, plan.scene_plan, ctx));
  const ruleIds = bibleRuleIds(input.creative_bible);
  for (const s of out.shots)
    errors.push(...checkRules(s.applied_rules, `${s.shot_id}: applied_rules`, ruleIds));
  errors.push(
    ...checkDialogueMatchesScript(
      out.shots,
      input.script,
      scriptIndexesFor(input.script, planSceneIds, range),
    ),
  );
  errors.push(...checkNoVoiceAssets(out));
  errors.push(...checkLookVocabulary(out));
  return errors;
}

/** Mode `repair`: requested scenes only, dialogue and outer staging kept, failures warned. */
export function checkDirectorV2Repair(
  out: DirectorV2RepairOutput,
  input: DirectorV2RepairInput,
): string[] {
  const preflight = checkPreflightV2(out, input.creative_bible, false);
  if (out.status === "blocked" || input.creative_bible.validation_status === "rejected")
    return preflight;
  const errors = [...modeIs(out, "repair"), ...preflight];
  const requested = new Set(input.repair_requests.map((r) => r.scene_id));
  const repaired = new Set<string>();
  const plan = input.plan;
  const lastSceneId = plan.scene_plan[plan.scene_plan.length - 1]?.scene_id;
  const planStaging = new Set(
    [...plan.staging_states, ...input.current_shots.staging_states].map((s) => s.staging_id),
  );
  for (const repair of out.repairs) {
    const sceneId = repair.scene_id;
    if (!requested.has(sceneId)) {
      errors.push(`repairs: ${sceneId} was not requested; never touch other scenes`);
      continue;
    }
    if (repaired.has(sceneId)) errors.push(`repairs: ${sceneId} is repaired twice`);
    repaired.add(sceneId);
    const current = input.current_shots.shots.filter((s) => s.scene_id === sceneId);
    if (repair.shots.length === 0) {
      errors.push(`repairs: ${sceneId} has no shots`);
      continue;
    }
    for (const shot of repair.shots) {
      if (shot.scene_id !== sceneId)
        errors.push(
          `${shot.shot_id}: a shot of the ${sceneId} repair has scene_id "${shot.scene_id}"`,
        );
    }
    for (const state of repair.staging_states) {
      if (planStaging.has(state.staging_id))
        errors.push(
          `repairs: "${state.staging_id}" already exists; return only new staging states`,
        );
    }
    const ctx = shotCtx(input, [
      ...plan.staging_states,
      ...input.current_shots.staging_states,
      ...repair.staging_states,
    ]);
    const first = current[0];
    const last = current[current.length - 1];
    errors.push(
      ...checkSceneShots(sceneId, repair.shots, {
        plan: plan.scene_plan.find((s) => s.scene_id === sceneId),
        lastScene: sceneId === lastSceneId,
        outer:
          first && last ? { start: first.staging_start_id, end: last.staging_end_id } : undefined,
      }),
    );
    errors.push(...checkShots(repair.shots, ctx));
    const before = spokenText(current.flatMap((s) => s.dialogue.map((d) => d.line)));
    const after = spokenText(repair.shots.flatMap((s) => s.dialogue.map((d) => d.line)));
    if (before !== after)
      errors.push(`repairs: ${sceneId} must keep its dialogue exactly (lines, order and wording)`);
    const ruleIds = bibleRuleIds(input.creative_bible);
    for (const s of repair.shots)
      errors.push(...checkRules(s.applied_rules, `${s.shot_id}: applied_rules`, ruleIds));
  }
  for (const sceneId of requested) {
    const failed = out.warnings.some(
      (w) => w.type === "repair_failed" && (w.ref === sceneId || w.message.includes(sceneId)),
    );
    if (!repaired.has(sceneId) && !failed) {
      errors.push(`${sceneId}: repair it, or add a "repair_failed" warning with the reason`);
    }
  }
  errors.push(...checkNoVoiceAssets(out));
  errors.push(...checkLookVocabulary(out));
  return errors;
}
