/** The cinematographer's semantic checks (pure). */
import { cinematographerCard, isCardMode, type CinematographerId } from "../library";
import type {
  CinematographerInput,
  CinematographerOutput,
  CinematographerResult,
  Look,
  LookInput,
  SceneInput,
  SceneVisual,
} from "./schema";

function badMode(id: CinematographerId, modeId: string, where: string): string[] {
  if (isCardMode(id, modeId)) return [];
  const modes = cinematographerCard(id)
    .modes.map((m) => m.id)
    .join(", ");
  return [`${where}: mode_id "${modeId}" is not a mode of the ${id} card (${modes})`];
}

/** Each input scene gets exactly one valid mode, and no other scene is answered. */
export function checkLook(look: Look, input: LookInput): string[] {
  const errors: string[] = [];
  if (look.cinematographer_id !== input.cinematographer_id) {
    errors.push(`look.cinematographer_id must be "${input.cinematographer_id}"`);
  }
  const wanted = new Set(input.scenes.map((s) => s.scene_id));
  const seen = new Map<string, number>();
  for (const entry of look.scene_modes) {
    seen.set(entry.scene_id, (seen.get(entry.scene_id) ?? 0) + 1);
    if (!wanted.has(entry.scene_id)) {
      errors.push(`look.scene_modes: scene "${entry.scene_id}" is not one of the input scenes`);
    }
    errors.push(...badMode(input.cinematographer_id, entry.mode_id, `scene ${entry.scene_id}`));
  }
  for (const id of wanted) {
    const count = seen.get(id) ?? 0;
    if (count !== 1) {
      errors.push(`look.scene_modes: scene "${id}" needs exactly one mode (has ${count})`);
    }
  }
  return errors;
}

/** The scene matches, its mode is the card's (and the look's), and every shot is answered once. */
export function checkSceneVisual(scene: SceneVisual, input: SceneInput): string[] {
  const errors: string[] = [];
  if (scene.scene_id !== input.scene.scene_id) {
    errors.push(`scene.scene_id must be "${input.scene.scene_id}"`);
  }
  errors.push(...badMode(input.cinematographer_id, scene.mode_id, `scene ${scene.scene_id}`));
  const planned = input.look.scene_modes.find((m) => m.scene_id === input.scene.scene_id);
  if (planned && planned.mode_id !== scene.mode_id) {
    errors.push(
      `scene ${scene.scene_id}: mode_id "${scene.mode_id}" differs from the look's "${planned.mode_id}"`,
    );
  }
  const wanted = new Set(input.shots.map((s) => s.shot_id));
  const seen = new Map<string, number>();
  for (const shot of scene.shots) {
    seen.set(shot.shot_id, (seen.get(shot.shot_id) ?? 0) + 1);
    if (!wanted.has(shot.shot_id)) {
      errors.push(`scene.shots: "${shot.shot_id}" is not one of the input shots`);
    }
  }
  for (const id of wanted) {
    const count = seen.get(id) ?? 0;
    if (count !== 1)
      errors.push(`scene.shots: shot "${id}" must be answered exactly once (${count})`);
  }
  return errors;
}

export function checkCinematographer(
  output: CinematographerOutput,
  input: CinematographerInput,
): string[] {
  if (output.mode !== input.mode) return [`mode must be "${input.mode}"`];
  if (input.mode === "look") {
    if (!output.look) return ['mode "look" needs `look` (and `scene` null)'];
    return [
      ...(output.scene ? ["`scene` must be null in mode look"] : []),
      ...checkLook(output.look, input),
    ];
  }
  if (!output.scene) return ['mode "scene" needs `scene` (and `look` null)'];
  return [
    ...(output.look ? ["`look` must be null in mode scene"] : []),
    ...checkSceneVisual(output.scene, input),
  ];
}

/** The checked answer as the discriminated result (check() has proved the right half is there). */
export function finalizeCinematographer(
  output: CinematographerOutput,
  input: CinematographerInput,
): CinematographerResult {
  if (input.mode === "look") {
    if (!output.look) throw new Error("cinematographer: look answer without look");
    return { mode: "look", look: output.look };
  }
  if (!output.scene) throw new Error("cinematographer: scene answer without scene");
  return { mode: "scene", scene: output.scene };
}
