/**
 * Groups a parsed screenplay into commentable blocks and scenes, for the paper sheet. Pure: no
 * React, no server code.
 */

import { parseScreenplay, type ScreenplayLine } from "./screenplay";

export type ScreenplayBlockKind = "heading" | "episode" | "action" | "dialogue" | "transition";

/** One thing a reader comments on: a scene heading, a paragraph, or a character's speech. */
export interface ScreenplayBlock {
  kind: ScreenplayBlockKind;
  lines: ScreenplayLine[];
  /** Offsets of the block in the script; `script.slice(start, end)` is its text. */
  start: number;
  end: number;
}

export interface Scene {
  /** Stable key: the offset where the scene starts. */
  key: string;
  /** The scene heading ("INT. LIGHTHOUSE - NIGHT"), or null for the text before the first one. */
  heading: string | null;
  blocks: ScreenplayBlock[];
  start: number;
  end: number;
}

function block(kind: ScreenplayBlockKind, line: ScreenplayLine): ScreenplayBlock {
  return { kind, lines: [line], start: line.start, end: line.end };
}

function extend(target: ScreenplayBlock, line: ScreenplayLine) {
  target.lines.push(line);
  target.end = line.end;
}

/** Lines into blocks: a cue and its speech make one block, an unbroken paragraph makes one. */
export function toBlocks(lines: ScreenplayLine[]): ScreenplayBlock[] {
  const blocks: ScreenplayBlock[] = [];
  for (const line of lines) {
    const last = blocks[blocks.length - 1];
    switch (line.type) {
      case "scene_heading":
        blocks.push(block("heading", line));
        break;
      case "episode":
        blocks.push(block("episode", line));
        break;
      case "transition":
        blocks.push(block("transition", line));
        break;
      case "character":
        blocks.push(block("dialogue", line));
        break;
      case "parenthetical":
      case "dialogue":
        if (last?.kind === "dialogue" && !line.breakBefore) extend(last, line);
        else blocks.push(block("action", line));
        break;
      case "action":
        if (last?.kind === "action" && !line.breakBefore) extend(last, line);
        else blocks.push(block("action", line));
        break;
    }
  }
  return blocks;
}

/**
 * The script cut into scenes at each scene heading. An episode title just before a heading opens
 * that heading's scene. Text before the first heading is a scene without a heading.
 */
export function splitScenes(script: string): Scene[] {
  const blocks = toBlocks(parseScreenplay(script));
  const scenes: Scene[] = [];
  let current: ScreenplayBlock[] = [];
  let heading: string | null = null;

  const close = () => {
    if (current.length === 0) return;
    const first = current[0] as ScreenplayBlock;
    const last = current[current.length - 1] as ScreenplayBlock;
    scenes.push({
      key: String(first.start),
      heading,
      blocks: current,
      start: first.start,
      end: last.end,
    });
  };

  for (const b of blocks) {
    if (b.kind !== "heading") {
      current.push(b);
      continue;
    }
    // Episode titles at the end of the previous scene belong to the scene they open.
    const carried: ScreenplayBlock[] = [];
    while (current.length > 0 && current[current.length - 1]?.kind === "episode") {
      carried.unshift(current.pop() as ScreenplayBlock);
    }
    close();
    current = [...carried, b];
    heading = b.lines[0]?.text ?? null;
  }
  close();
  return scenes;
}

/** Index of the block holding `offset` (the last block starting at or before it). */
export function blockIndexAt(blocks: ScreenplayBlock[], offset: number): number {
  let found = -1;
  for (let i = 0; i < blocks.length; i++) {
    if ((blocks[i] as ScreenplayBlock).start <= offset) found = i;
    else break;
  }
  return found === -1 ? 0 : found;
}

/** Index of the scene holding `offset`. */
export function sceneIndexAt(scenes: Scene[], offset: number): number {
  let found = 0;
  for (let i = 0; i < scenes.length; i++) {
    if ((scenes[i] as Scene).start <= offset) found = i;
    else break;
  }
  return found;
}
