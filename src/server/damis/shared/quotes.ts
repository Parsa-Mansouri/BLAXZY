/** Whitespace-insensitive search, so a quote survives line-wrapping and CRLF differences. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function containsQuote(haystack: string, quote: string): boolean {
  const needle = collapse(quote);
  if (!needle) return true;
  return collapse(haystack).includes(needle);
}
