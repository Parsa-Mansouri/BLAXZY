/**
 * Running the Asset Detector v2 from the worker: build its input from a script version (the
 * structured scenes of a generated script, or the raw text of an uploaded, edited or enhanced
 * one), translate stored assets to the run's temporary ids, and, when the answer is cut off
 * (max_tokens), split the script into scene ranges and continue incrementally.
 */
import { ownerGenreName, ownerStyleName } from "../../src/lib/style-options";
import { detectorView, type DetectorView, type KnownRow } from "../../src/server/assets";
import {
  assetDetector,
  DamiTruncatedError,
  flattenForDetector,
  isSceneHeading,
  parseStoredScreenplay,
  renderCreativeDna,
  runDami,
  type AssetDetectorInput,
  type AssetDetectorOutput,
  type DetectorFixRequest,
  type DetectorMode,
} from "../../src/server/damis";
import type { DetectionSceneIndexEntry, ProjectStyle } from "../../src/server/db/schema";
import { getReadyBible } from "../../src/server/projects";
import { readScriptNotes, type ScriptVersionRow } from "../../src/server/script";

type Scene = NonNullable<AssetDetectorInput["script"]["scenes"]>[number];

export type DetectorRunContext = { userId: string; projectId: string; signal: AbortSignal };

export type DetectorRun = { output: AssetDetectorOutput; runId: string | null };

/** The script as the detector reads it: structured scenes, or the raw text. */
export function detectorScript(version: ScriptVersionRow): AssetDetectorInput["script"] {
  const notes = readScriptNotes(version.damiNotes);
  const stored = parseStoredScreenplay(version.screenplay);
  const base = {
    title: notes.title ?? stored?.screenplay.title ?? "",
    logline: notes.logline ?? stored?.screenplay.logline ?? "",
    source: stored ? ("generated" as const) : ("uploaded" as const),
  };
  if (stored) return { ...base, scenes: flattenForDetector(stored) };
  return { ...base, raw_text: version.content ?? "" };
}

/**
 * The input field carrying the project's Creative Bible, when one is ready. Detection runs right
 * after the script is accepted, so a bible still compiling (or failed, or none for an "Other"
 * style) is not waited for: the detector then runs on its own prompt, unchanged.
 */
export async function detectorBible(
  projectId: string,
): Promise<Pick<AssetDetectorInput, "creativeDna">> {
  const ready = await getReadyBible(projectId);
  return ready ? { creativeDna: renderCreativeDna("asset_detector", ready.bible).text } : {};
}

export function detectorProject(
  style: ProjectStyle,
  sector: "wizard" | "pro",
): AssetDetectorInput["project"] {
  return {
    format: style.format,
    genre: ownerGenreName(style.genre),
    style: ownerStyleName(style.visualStyle),
    era_setting: style.eraSetting ?? null,
    ui_language: "en",
    sector,
  };
}

/** Scenes of a raw script, split at its headings (one scene when there are none). */
function rawScenes(text: string): Scene[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const scenes: { heading: string; body: string[] }[] = [];
  for (const line of lines) {
    if (isSceneHeading(line)) scenes.push({ heading: line.trim(), body: [] });
    else if (scenes.length === 0) scenes.push({ heading: "", body: [line] });
    else scenes[scenes.length - 1]?.body.push(line);
  }
  return scenes.map((s, i) => ({
    scene_number: String(i + 1),
    heading: s.heading,
    text: s.body.join("\n").trim(),
  }));
}

/** Two outputs of consecutive scene ranges as one (the second ran incrementally). */
export function mergeRangeOutputs(
  a: AssetDetectorOutput,
  b: AssetDetectorOutput,
): AssetDetectorOutput {
  const union = (x: string[], y: string[]) => [...new Set([...x, ...y])];
  const mergeBy = <T>(list1: T[], list2: T[], id: (t: T) => string, merge: (p: T, q: T) => T) => {
    const map = new Map(list1.map((t) => [id(t), t]));
    for (const t of list2) {
      const prev = map.get(id(t));
      map.set(id(t), prev ? merge(prev, t) : t);
    }
    return [...map.values()];
  };
  const scene_index = [...a.scene_index, ...b.scene_index];
  const order = new Map(scene_index.map((s, i) => [s.scene_number, i]));
  const first = (refs: string[]) =>
    [...refs].sort((p, q) => (order.get(p) ?? 0) - (order.get(q) ?? 0))[0] ?? "";
  const characters = mergeBy(
    a.characters,
    b.characters,
    (c) => c.char_id,
    (p, q) => {
      const scene_refs = union(p.scene_refs, q.scene_refs);
      return {
        ...p,
        aliases: union(p.aliases, q.aliases),
        facts: [...p.facts, ...q.facts],
        looks: mergeBy(
          p.looks,
          q.looks,
          (l) => l.look_id,
          (l1, l2) => ({
            ...l1,
            scene_refs: union(l1.scene_refs, l2.scene_refs),
          }),
        ),
        speaks: p.speaks || q.speaks,
        dialogue_line_count: p.dialogue_line_count + q.dialogue_line_count,
        dialogue_language: p.dialogue_language ?? q.dialogue_language,
        voice_delivery: [...new Set([...p.voice_delivery, ...q.voice_delivery])],
        voice_hints: [...p.voice_hints, ...q.voice_hints],
        scene_refs,
        first_scene: first(scene_refs),
      };
    },
  );
  const locations = mergeBy(
    a.locations,
    b.locations,
    (l) => l.loc_id,
    (p, q) => {
      const scene_refs = union(p.scene_refs, q.scene_refs);
      return {
        ...p,
        aliases: union(p.aliases, q.aliases),
        facts: [...p.facts, ...q.facts],
        states: mergeBy(
          p.states,
          q.states,
          (s) => s.state_id,
          (s1, s2) => ({
            ...s1,
            scene_refs: union(s1.scene_refs, s2.scene_refs),
          }),
        ),
        times_of_day: [...new Set([...p.times_of_day, ...q.times_of_day])],
        fixed_elements_from_script: [
          ...p.fixed_elements_from_script,
          ...q.fixed_elements_from_script,
        ],
        scene_refs,
        first_scene: first(scene_refs),
      };
    },
  );
  const props = mergeBy(
    a.props,
    b.props,
    (p) => p.prop_id,
    (p, q) => {
      const scene_refs = union(p.scene_refs, q.scene_refs);
      return {
        ...p,
        aliases: union(p.aliases, q.aliases),
        facts: [...p.facts, ...q.facts],
        states: mergeBy(
          p.states,
          q.states,
          (s) => s.state_id,
          (s1, s2) => ({
            ...s1,
            scene_refs: union(s1.scene_refs, s2.scene_refs),
          }),
        ),
        users: union(p.users, q.users),
        location_ids: union(p.location_ids, q.location_ids),
        scene_refs,
        first_scene: first(scene_refs),
      };
    },
  );
  const firstIds = new Set([
    ...a.characters.map((c) => c.char_id),
    ...a.locations.map((l) => l.loc_id),
    ...a.props.map((p) => p.prop_id),
  ]);
  return {
    ...a,
    scene_index,
    characters,
    locations,
    props,
    diff: {
      added: union(a.diff.added, b.diff.added),
      updated: union(a.diff.updated, b.diff.updated).filter((id) => !a.diff.added.includes(id)),
      // The second range only lacks the first range's assets: they are not removed.
      removed: union(
        a.diff.removed,
        b.diff.removed.filter((id) => !firstIds.has(id)),
      ),
    },
    summary: {
      scene_count: scene_index.length,
      character_count: characters.length,
      location_count: locations.length,
      prop_count: props.length,
    },
    applied_fixes: [...a.applied_fixes, ...b.applied_fixes],
    assumptions: [...a.assumptions, ...b.assumptions],
    warnings: [...new Set([...a.warnings, ...b.warnings])],
  };
}

/** The first range's answer as `known_assets` for the next range. */
function knownFrom(
  output: AssetDetectorOutput,
  previous: NonNullable<AssetDetectorInput["known_assets"]>,
): NonNullable<AssetDetectorInput["known_assets"]> {
  const known = new Map(previous.map((k) => [k.id, k]));
  const add = (id: string, entry: Record<string, unknown>) =>
    known.set(id, { id, status: known.get(id)?.status ?? "detected", entry });
  for (const c of output.characters) add(c.char_id, c);
  for (const l of output.locations) add(l.loc_id, l);
  for (const p of output.props) add(p.prop_id, p);
  return [...known.values()];
}

/**
 * Runs the detector; when the answer is cut off (max_tokens), splits the scenes in two, runs the
 * first half in the given mode and the second incrementally with what the first found, and merges.
 */
export async function runDetector(
  input: AssetDetectorInput,
  run: DetectorRunContext,
): Promise<DetectorRun> {
  try {
    const result = await runDami(assetDetector, input, run);
    return { output: result.output, runId: result.runId };
  } catch (error) {
    if (!(error instanceof DamiTruncatedError) || input.mode === "fix") throw error;
    const scenes = input.script.scenes ?? rawScenes(input.script.raw_text ?? "");
    if (scenes.length < 2) throw error;
    const half = Math.ceil(scenes.length / 2);
    const script = { ...input.script, raw_text: undefined };
    const first = await runDetector(
      { ...input, script: { ...script, scenes: scenes.slice(0, half) } },
      run,
    );
    const second = await runDetector(
      {
        ...input,
        mode: "incremental",
        script: { ...script, scenes: scenes.slice(half) },
        known_assets: knownFrom(first.output, input.known_assets ?? []),
      },
      run,
    );
    return { output: mergeRangeOutputs(first.output, second.output), runId: second.runId };
  }
}

/** The run's id map and inputs from the stored assets and the latest scene index. */
export function viewFor(
  rows: KnownRow[],
  sceneIndex: DetectionSceneIndexEntry[],
  mode: DetectorMode,
): DetectorView {
  return detectorView(rows, sceneIndex, mode);
}

export type { DetectorFixRequest };
