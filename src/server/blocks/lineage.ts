/**
 * Pure rules of block lineage: which previous block a new one continues (same or edited excerpt)
 * and how logged ref rewrites apply to a block's refs.
 */
import type { PromptBlock } from "./common";

/** Whitespace-normalised excerpt: the key that carries a block's lineage across script versions. */
export function normalizeExcerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function sameAssets(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((ref, i) => ref === b[i]);
}

/** How close two excerpts are (Dice coefficient over their words, 0 to 1). */
export function excerptSimilarity(a: string, b: string): number {
  const words = (text: string) =>
    normalizeExcerpt(text)
      .toLowerCase()
      .match(/[\p{L}\p{N}']+/gu) ?? [];
  const left = words(a);
  const right = words(b);
  if (left.length === 0 || right.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const word of left) counts.set(word, (counts.get(word) ?? 0) + 1);
  let common = 0;
  for (const word of right) {
    const n = counts.get(word) ?? 0;
    if (n > 0) {
      common++;
      counts.set(word, n - 1);
    }
  }
  return (2 * common) / (left.length + right.length);
}

/** An edited shot (same place in the story, mostly the same words) continues its lineage. */
const EDITED_SIMILARITY = 0.6;

/** How far (in story positions) an edited shot may have moved. */
const EDITED_WINDOW = 3;

/**
 * The previous block each new block continues: first an identical excerpt (whitespace-
 * normalised), then, among the blocks left, an edited version of the same shot (a similar excerpt
 * near the same position). Unmatched new blocks start a new lineage.
 */
export function matchPrevious(
  previous: PromptBlock[],
  blocks: readonly { scriptExcerpt: string; orderIndex: number }[],
): (PromptBlock | null)[] {
  const byExcerpt = new Map<string, PromptBlock[]>();
  for (const row of previous) {
    const key = normalizeExcerpt(row.scriptExcerpt);
    byExcerpt.set(key, [...(byExcerpt.get(key) ?? []), row]);
  }
  const matches = blocks.map(
    (block) => byExcerpt.get(normalizeExcerpt(block.scriptExcerpt))?.shift() ?? null,
  );
  const taken = new Set(matches.flatMap((m) => (m ? [m.id] : [])));
  const left = previous.filter((row) => !taken.has(row.id));
  blocks.forEach((block, i) => {
    if (matches[i]) return;
    let best: { row: PromptBlock; score: number; distance: number } | null = null;
    for (const row of left) {
      if (taken.has(row.id)) continue;
      const distance = Math.abs(row.orderIndex - block.orderIndex);
      if (distance > EDITED_WINDOW) continue;
      const score = excerptSimilarity(row.scriptExcerpt, block.scriptExcerpt);
      if (score < EDITED_SIMILARITY) continue;
      if (!best || score > best.score || (score === best.score && distance < best.distance)) {
        best = { row, score, distance };
      }
    }
    if (best) {
      matches[i] = best.row;
      taken.add(best.row.id);
    }
  });
  return matches;
}

/** Applies the ref rewrites logged after `since` (oldest first) to a list of refs. */
export function applyRewrites(
  refs: readonly string[],
  since: Date,
  rewrites: readonly { from: string; to: string; at: Date }[],
): string[] {
  let out = [...refs];
  for (const r of rewrites) {
    if (r.at <= since) continue;
    out = [...new Set(out.map((ref) => (ref === r.from ? r.to : ref)))];
  }
  return out;
}
