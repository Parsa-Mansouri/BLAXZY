/**
 * Sample prompt-sectioner: cuts exactly the requested line range into blocks at scene headings
 * and paragraph breaks, and writes a screenplay-style prompt per block that tags the assets named
 * in its excerpt.
 */
import type { z } from "zod";
import {
  MAX_BLOCK_SECONDS,
  promptSectionerInputSchema,
  type PromptSectionerModelBlock,
} from "../prompt-sectioner/schema";
import { isBlank, isSceneHeading, sliceLines, splitLines } from "../shared/script-lines";
import { WORDS_PER_MINUTE } from "../shared/style";
import { collapseWhitespace, countWords, headingPlace, isTransition, truncate } from "./util";

type Input = z.output<typeof promptSectionerInputSchema>;

/** About 15 seconds of screenplay text. */
const MAX_BLOCK_WORDS = Math.floor((WORDS_PER_MINUTE / 60) * MAX_BLOCK_SECONDS);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Assets whose name (or slug words) appear in the text, in order of first appearance. */
function assetsIn(text: string, assets: Input["assets"]) {
  const found: Array<{ index: number; asset: Input["assets"][number] }> = [];
  for (const asset of assets) {
    const names = [asset.name, asset.slug.replace(/-/g, " ")];
    let index = -1;
    for (const name of names) {
      const match = new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`,
        "iu",
      ).exec(text);
      if (match && (index < 0 || match.index < index)) index = match.index;
    }
    if (index >= 0) found.push({ index, asset });
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.asset);
}

type Range = { startLine: number; endLine: number };

/** Splits the range at scene headings and, past the word budget, at paragraph breaks. */
function cut(lines: string[], range: Range): Range[] {
  const blocks: Range[] = [];
  let current: Range | null = null;
  let words = 0;
  for (let n = range.startLine; n <= range.endLine; n++) {
    const line = lines[n - 1] ?? "";
    // Transitions (FADE IN:) and blank lines stay with the block that follows them.
    const paragraphStart = !isBlank(line) && isBlank(lines[n - 2]);
    const startNew =
      current !== null &&
      words > 0 &&
      (isSceneHeading(line) || (paragraphStart && words >= MAX_BLOCK_WORDS * 0.6));
    if (current === null || startNew) {
      if (current) blocks.push(current);
      current = { startLine: n, endLine: n };
      words = 0;
    } else {
      current.endLine = n;
    }
    if (!isTransition(line)) words += countWords(line);
  }
  if (current) blocks.push(current);
  return blocks;
}

export function samplePromptSectioner(raw: unknown): { blocks: PromptSectionerModelBlock[] } {
  const input: Input = promptSectionerInputSchema.parse(raw);
  const lines = splitLines(input.content);
  const range = input.range ?? { startLine: 1, endLine: lines.length };
  const style = input.style;
  const frame = style.orientation === "portrait" ? "vertical 9:16" : "widescreen 16:9";

  // The scene heading in force at the start of the range (it may lie before the range).
  let heading: string | null = null;
  for (let n = range.startLine; n >= 1; n--) {
    if (isSceneHeading(lines[n - 1] ?? "")) {
      heading = (lines[n - 1] ?? "").trim();
      break;
    }
  }

  let sceneNumber = lines.slice(0, range.startLine - 1).filter(isSceneHeading).length;
  return {
    blocks: cut(lines, range).map((block) => {
      const excerpt = sliceLines(lines, block.startLine, block.endLine);
      for (const line of excerpt.split("\n")) {
        if (isSceneHeading(line)) {
          heading = line.trim();
          sceneNumber++;
        }
      }
      const found = assetsIn(`${heading ?? ""}\n${excerpt}`, input.assets);
      const tag = (a: Input["assets"][number]) => `${a.name} [${a.kind}:${a.slug}]`;
      const where = found.filter((a) => a.kind === "location");
      const cast = found.filter((a) => a.kind === "character");
      const things = found.filter((a) => a.kind !== "location" && a.kind !== "character");
      const action = collapseWhitespace(
        excerpt
          .split("\n")
          .filter((l) => !isSceneHeading(l) && !isTransition(l))
          .join(" "),
      );
      const words = countWords(excerpt);
      const seconds = Math.min(
        MAX_BLOCK_SECONDS,
        Math.max(2, Math.round((words / WORDS_PER_MINUTE) * 60)),
      );
      const place = heading ? headingPlace(heading) : "";
      const prompt = [
        `STYLE: ${style.visualStyle}, ${style.genre.toLowerCase()} mood, ${frame}.`,
        `SCENE: ${where.length ? where.map(tag).join(", ") : place || "as established"}${heading ? ` (${heading})` : ""}.`,
        ...(cast.length ? [`CAST: ${cast.map(tag).join(", ")}.`] : []),
        ...(things.length ? [`PROPS: ${things.map(tag).join(", ")}.`] : []),
        `SHOT 1 (0-${seconds}s): ${truncate(action || "Hold on the scene.", 1200)}`,
        "SOUND: room tone and the scene's natural sound.",
      ].join("\n");
      const label = truncate(action || place || "Scene", 50);
      return {
        title: truncate(`Sc ${Math.max(1, sceneNumber)} · ${label}`, 80),
        startLine: block.startLine,
        endLine: block.endLine,
        prompt: prompt.slice(0, 6000),
        durationSeconds: seconds,
        assetRefs: found.map((a) => `${a.kind}:${a.slug}`),
      };
    }),
  };
}
