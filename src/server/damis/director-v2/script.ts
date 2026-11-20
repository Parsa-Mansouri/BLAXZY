/**
 * Light reading of a screenplay-format script for DIRECTOR v2.0's checks: its scenes (by heading)
 * and the spoken lines of each, in order. A character cue is a short upper-case line followed by
 * dialogue (`cueName`); parentheticals are not spoken. Scripts in another layout may yield no
 * speech at all; the checks then fall back to "each line is a line of the script, in order".
 */
import { cueName, isSceneHeading, isTransition, splitLines } from "../shared/script-lines";

export type ScriptSpeech = { speaker: string; line: string };
export type ScriptScene = { heading: string | null; speeches: ScriptSpeech[] };

export function scriptScenes(script: string): ScriptScene[] {
  const lines = splitLines(script);
  const scenes: ScriptScene[] = [];
  let current: ScriptScene | null = null;
  let i = 0;
  while (i < lines.length) {
    if ((lines[i] ?? "").trim() === "") {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && (lines[i] ?? "").trim() !== "") i++;
    let block = lines.slice(start, i).map((l) => l.trim());
    let cueAt = start;
    if (isSceneHeading(block[0] ?? "")) {
      current = { heading: block[0] ?? null, speeches: [] };
      scenes.push(current);
      block = block.slice(1);
      cueAt = start + 1;
      if (block.length === 0) continue;
    }
    if (isTransition(block[0] ?? "")) continue;
    if (!current) {
      current = { heading: null, speeches: [] };
      scenes.push(current);
    }
    const speaker = cueName(lines, cueAt);
    if (!speaker) continue;
    for (const line of block.slice(1)) {
      if (line.startsWith("(") && line.endsWith(")")) continue;
      current.speeches.push({ speaker, line });
    }
  }
  return scenes;
}

/** Whitespace collapsed, curly quotes straightened: how spoken text is compared. */
export function normalizeSpoken(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

/** Lines joined with single spaces, normalized: line breaks inside a speech do not matter. */
export function spokenText(lines: readonly string[]): string {
  return normalizeSpoken(lines.join(" "));
}
