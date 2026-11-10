import { normalizeNewlines, splitLines } from "../shared/script-lines";
import type { ScriptLineEdit } from "./schema";

const NUMBERED_LINE = /^\s*\d+\|\s/;

/** Problems with a set of line edits against a script of `lineCount` lines. */
export function validateLineEdits(edits: ScriptLineEdit[], lineCount: number): string[] {
  const issues: string[] = [];
  let previousEnd = 0;
  edits.forEach((edit, i) => {
    if (edit.startLine > edit.endLine) {
      issues.push(`edits.${i}: startLine ${edit.startLine} is after endLine ${edit.endLine}`);
    }
    if (edit.endLine > lineCount) {
      issues.push(`edits.${i}: endLine ${edit.endLine} is past the last line (${lineCount})`);
    }
    if (edit.startLine <= previousEnd) {
      issues.push(
        `edits.${i}: lines ${edit.startLine}-${edit.endLine} overlap or come before the previous edit (ending at line ${previousEnd}); list edits in script order without overlaps`,
      );
    }
    previousEnd = Math.max(previousEnd, edit.endLine);
    const numbered = splitLines(edit.replacement).filter((l) => NUMBERED_LINE.test(l)).length;
    if (numbered > 0) {
      issues.push(`edits.${i}: replacement contains line-number prefixes ("12| "); remove them`);
    }
  });
  return issues;
}

/**
 * Applies validated, ordered, non-overlapping edits. Untouched lines are kept byte for byte;
 * an empty replacement deletes the lines.
 */
export function applyLineEdits(content: string, edits: ScriptLineEdit[]): string {
  const lines = splitLines(content);
  const out: string[] = [];
  let next = 1;
  for (const edit of edits) {
    out.push(...lines.slice(next - 1, edit.startLine - 1));
    if (edit.replacement !== "") out.push(...splitLines(normalizeNewlines(edit.replacement)));
    next = edit.endLine + 1;
  }
  out.push(...lines.slice(next - 1));
  return out.join("\n");
}
