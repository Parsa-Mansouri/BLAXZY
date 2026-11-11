/** A piece of a prepared prompt: plain text, or a reference token such as `<<<image_2>>>`. */
export type PromptSegment =
  { type: "text"; text: string } | { type: "image"; index: number; token: string };

const TOKEN = /<<<image_(\d+)>>>/g;

/**
 * Splits a prepared prompt at its reference tokens. `index` is the 1-based position of the
 * reference in the shot's asset list, so `assets[index - 1]` is the asset the token stands for.
 */
export function splitPrompt(prompt: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let last = 0;
  for (const match of prompt.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ type: "text", text: prompt.slice(last, at) });
    segments.push({ type: "image", index: Number(match[1]), token: match[0] });
    last = at + match[0].length;
  }
  if (last < prompt.length) segments.push({ type: "text", text: prompt.slice(last) });
  return segments;
}
