/**
 * The script text each Director block covers, from its `script_coverage` quotes. Pure.
 * The validator proves the quotes occur in order (`checkScriptCoverage`); this returns the span
 * of the ORIGINAL script from the first word of `start_quote` to the last word of `end_quote`
 * (line breaks kept), so a block's excerpt is the same text the script shows and stays the key
 * that carries the block's lineage across script versions.
 */
import { normalizeQuoteText } from "../shared/quotes";

type Token = { text: string; start: number; end: number };

function tokens(script: string): Token[] {
  const out: Token[] = [];
  for (const match of script.matchAll(/\S+/g)) {
    out.push({
      text: normalizeQuoteText(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return out;
}

function words(quote: string): string[] {
  return normalizeQuoteText(quote)
    .split(" ")
    .filter((w) => w !== "");
}

function indexOfWords(all: readonly Token[], needle: readonly string[], from: number): number {
  if (needle.length === 0) return -1;
  for (let i = from; i + needle.length <= all.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (all[i + j]?.text !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function lastIndexOfWords(
  all: readonly Token[],
  needle: readonly string[],
  from: number,
  before: number,
): number {
  if (needle.length === 0) return -1;
  for (let i = Math.min(before, all.length) - needle.length; i >= from; i--) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (all[i + j]?.text !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

/**
 * One excerpt per block, in order. A block whose quotes cannot be placed (the validator allows a
 * small tolerance, so this is rare) gets its two quotes joined: never empty.
 */
export function blockExcerpts(
  script: string,
  coverages: readonly { start_quote: string; end_quote: string }[],
): string[] {
  const all = tokens(script);
  const starts: (number | null)[] = [];
  let cursor = 0;
  for (const c of coverages) {
    const needle = words(c.start_quote);
    const at = indexOfWords(all, needle, cursor);
    starts.push(at < 0 ? null : at);
    if (at >= 0) cursor = at + needle.length;
  }
  return coverages.map((c, i) => {
    const fallback = [c.start_quote, c.end_quote]
      .map((q) => q.trim())
      .filter(Boolean)
      .join(" … ");
    const start = starts[i];
    if (start === null || start === undefined) return fallback;
    const nextStart = starts.slice(i + 1).find((s): s is number => s !== null && s !== undefined);
    const needle = words(c.end_quote);
    const at = lastIndexOfWords(all, needle, start, nextStart ?? all.length);
    const first = all[start];
    const last = at < 0 ? undefined : all[at + needle.length - 1];
    if (!first || !last) return fallback;
    return script.slice(first.start, last.end);
  });
}
