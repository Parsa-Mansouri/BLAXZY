import { isBlank, type LineRange } from "../shared/script-lines";

function blankBetween(lines: string[], from: number, to: number): boolean {
  for (let i = from; i <= to; i++) if (!isBlank(lines[i - 1])) return false;
  return true;
}

/**
 * Problems with how `blocks` cover `range`: they must be in order and contiguous, without
 * overlaps or uncovered lines. Gaps made only of blank lines are tolerated (they are absorbed by
 * `absorbBlankGaps`).
 */
export function checkRangeCoverage(
  blocks: LineRange[],
  range: LineRange,
  lines: string[],
): string[] {
  const issues: string[] = [];
  let expected = range.startLine;
  blocks.forEach((block, i) => {
    if (block.startLine > block.endLine) {
      issues.push(`blocks.${i}: startLine ${block.startLine} is after endLine ${block.endLine}`);
      return;
    }
    if (block.startLine < expected) {
      issues.push(
        block.startLine < range.startLine
          ? `blocks.${i} starts at line ${block.startLine}, before the range start (${range.startLine})`
          : `blocks.${i} (lines ${block.startLine}-${block.endLine}) overlaps the previous block; each block starts on the line after the previous one ends`,
      );
    } else if (block.startLine > expected && !blankBetween(lines, expected, block.startLine - 1)) {
      issues.push(
        `lines ${expected}-${block.startLine - 1} are not covered by any block (before blocks.${i})`,
      );
    }
    if (block.endLine > range.endLine) {
      issues.push(
        `blocks.${i} ends at line ${block.endLine}, after the range end (${range.endLine})`,
      );
    }
    expected = Math.max(expected, block.endLine + 1);
  });
  if (expected <= range.endLine && !blankBetween(lines, expected, range.endLine)) {
    issues.push(`lines ${expected}-${range.endLine} at the end of the range are not covered`);
  }
  return issues;
}

/**
 * Turns valid block ranges into exact, gapless ranges over `range`: a blank-only gap is given to
 * the previous block (or to the first block when it precedes it).
 */
export function absorbBlankGaps<T extends LineRange>(blocks: T[], range: LineRange): T[] {
  return blocks.map((block, i) => {
    const next = blocks[i + 1];
    return {
      ...block,
      startLine: i === 0 ? range.startLine : block.startLine,
      endLine: next ? next.startLine - 1 : range.endLine,
    };
  });
}

/**
 * Verifies that consecutive block ranges tile lines 1..lineCount exactly. Used after stitching
 * segment results; a failure here is a bug, not a model error.
 */
export function assertTiles(blocks: LineRange[], lineCount: number): void {
  let expected = 1;
  for (const block of blocks) {
    if (block.startLine !== expected || block.endLine < block.startLine) {
      throw new Error(
        `Stitched blocks do not tile the script: expected a block starting at line ${expected}, got ${block.startLine}-${block.endLine}`,
      );
    }
    expected = block.endLine + 1;
  }
  if (expected !== lineCount + 1) {
    throw new Error(`Stitched blocks end at line ${expected - 1} but the script has ${lineCount}`);
  }
}
