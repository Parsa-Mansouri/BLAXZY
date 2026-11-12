/**
 * Quote matching for checks that verify a model copied text from the script (review quotes,
 * Asset Detector evidence). Both sides are normalized the same way, so a quote survives
 * line-wrapping, CRLF differences and the usual Persian/Arabic keyboard variants.
 */

/** Code points the owner's evidence rule normalizes (written as numbers: one is invisible). */
const ARABIC_YEH = 0x064a;
const ALEF_MAKSURA = 0x0649;
const ARABIC_KAF = 0x0643;
const PERSIAN_YEH = String.fromCharCode(0x06cc);
const PERSIAN_KAF = String.fromCharCode(0x06a9);
const ZWNJ = String.fromCharCode(0x200c);

const YEH_VARIANTS = new RegExp(`[${String.fromCharCode(ARABIC_YEH, ALEF_MAKSURA)}]`, "g");
const KAF_VARIANTS = new RegExp(String.fromCharCode(ARABIC_KAF), "g");
const ZWNJ_PATTERN = new RegExp(ZWNJ, "g");

/**
 * The form quotes are compared in (the owner's evidence rule: normalize whitespace and the
 * Persian/Arabic forms of ی/ي and ک/ك):
 * - Arabic yeh (U+064A) and alef maksura (U+0649) become Persian yeh (U+06CC); Arabic kaf
 *   (U+0643) becomes Persian keheh (U+06A9);
 * - the zero-width non-joiner (U+200C, the Persian half-space) is removed, so a word typed with
 *   or without it matches;
 * - every run of whitespace becomes one space, and the ends are trimmed.
 */
export function normalizeQuoteText(text: string): string {
  return text
    .replace(YEH_VARIANTS, PERSIAN_YEH)
    .replace(KAF_VARIANTS, PERSIAN_KAF)
    .replace(ZWNJ_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `quote` occurs in `haystack` after normalizing both. An empty quote always matches. */
export function containsQuote(haystack: string, quote: string): boolean {
  const needle = normalizeQuoteText(quote);
  if (!needle) return true;
  return normalizeQuoteText(haystack).includes(needle);
}
