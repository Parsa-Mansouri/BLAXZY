/** Whitespace-insensitive search, so a comment's quote survives line-wrapping and CRLF changes. */
export function containsQuoteInScript(content: string, quote: string): boolean {
  const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
  const needle = collapse(quote);
  return needle.length > 0 && collapse(content).includes(needle);
}
