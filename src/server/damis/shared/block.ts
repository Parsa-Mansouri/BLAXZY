/**
 * Pieces shared by the three production damis (text-blocks, block-reviser, take-fixer): the asset
 * and review schemas, the `<<<image_N>>>` token rules and their code check, and the renderers for
 * the user message. Prompt text here is part of each dami's stable base prompt: changing it means
 * bumping their versions.
 */
import { z } from "zod";
import { ASSET_KINDS } from "@/server/db/schema";
import { assetRefSchema, assetTagPattern, formatAssetRef } from "./asset-ref";

export { assetRefSchema };

/** The most reference images the video model accepts for one block. */
export const MAX_REFERENCE_IMAGES = 9;

/** The longest prompt the production damis return (their input prompts stay under 6000). */
export const MAX_PRODUCTION_PROMPT = 8000;

/** A strict token: `<<<image_3>>>`. */
export const IMAGE_TOKEN_PATTERN = /<<<image_([1-9]\d*)>>>/g;
/** Anything that looks like an attempt at a token, well formed or not. */
const TOKEN_LIKE_PATTERN = /<<<[^<>\n]*>>>/g;

export function imageToken(position: number): string {
  return `<<<image_${position}>>>`;
}

/** An asset that is ready to be used as a reference: `ref` is `kind:Name`. */
export const blockAssetSchema = z
  .object({
    ref: assetRefSchema,
    kind: z.enum(ASSET_KINDS),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).default(""),
  })
  .refine((asset) => asset.ref === formatAssetRef(asset.kind, asset.name), {
    path: ["ref"],
    message: "the ref must be the asset's kind:Name",
  });

export type BlockAsset = z.output<typeof blockAssetSchema>;

/** The refs a production prompt calls, in token order. */
export const productionAssetRefsSchema = z
  .array(assetRefSchema)
  .max(MAX_REFERENCE_IMAGES)
  .describe(
    `The kind:Name of each referenced asset; the position (1-based) is the N of its <<<image_N>>> token. At most ${MAX_REFERENCE_IMAGES}.`,
  );

export const productionPromptSchema = z
  .string()
  .trim()
  .min(20)
  .max(MAX_PRODUCTION_PROMPT)
  .describe("The finished video prompt, in English, with <<<image_N>>> tokens.");

/** Tokens of a prompt in order of first appearance, as numbers. */
export function tokenSequence(prompt: string): number[] {
  const seen: number[] = [];
  for (const match of prompt.matchAll(IMAGE_TOKEN_PATTERN)) {
    const n = Number(match[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

/** Token rules that need only the number of refs: well formed, every token has a ref, every ref is called. */
export function checkTokenRange(prompt: string, refCount: number): string[] {
  const issues: string[] = [];
  const strict = new Set<string>();
  for (const match of prompt.matchAll(IMAGE_TOKEN_PATTERN)) strict.add(match[0]);
  for (const like of new Set(prompt.match(TOKEN_LIKE_PATTERN) ?? [])) {
    if (!strict.has(like)) {
      issues.push(`"${like}" is not a valid token; write <<<image_N>>> with N from 1`);
    }
  }
  const used = new Set(tokenSequence(prompt));
  for (const n of [...used].sort((a, b) => a - b)) {
    if (n > refCount) {
      issues.push(
        `${imageToken(n)} has no ref: assetRefs has ${refCount} entr${refCount === 1 ? "y" : "ies"}`,
      );
    }
  }
  for (let n = 1; n <= refCount; n++) {
    if (!used.has(n)) {
      issues.push(
        `assetRefs entry ${n} is never called: ${imageToken(n)} is missing from the prompt`,
      );
    }
  }
  return issues;
}

/**
 * The full semantic check of a prepared prompt: tokens contiguous 1..N, each token has a ref, each
 * ref is called, only passed-in assets, no voices, no repeats, no leftover `[kind:Name]` tags.
 */
export function checkBlockPrompt(
  prompt: string,
  assetRefs: readonly string[],
  assets: readonly BlockAsset[],
): string[] {
  const issues: string[] = [];
  if (assetRefs.length > MAX_REFERENCE_IMAGES) {
    issues.push(
      `assetRefs has ${assetRefs.length} entries; the video model takes at most ${MAX_REFERENCE_IMAGES}`,
    );
  }
  const byRef = new Map(assets.map((a) => [a.ref, a]));
  const seen = new Set<string>();
  for (const ref of assetRefs) {
    if (seen.has(ref)) issues.push(`assetRefs lists "${ref}" more than once`);
    seen.add(ref);
    const asset = byRef.get(ref);
    if (!asset) issues.push(`assetRefs has "${ref}", which is not in the asset list`);
    else if (asset.kind === "voice") {
      issues.push(`assetRefs has "${ref}", a voice; voices are never image references`);
    }
  }
  issues.push(...checkTokenRange(prompt, assetRefs.length));
  for (const match of prompt.matchAll(assetTagPattern())) {
    issues.push(
      `the prompt still contains the tag [${match[1] ?? ""}]; replace it with its token or remove it`,
    );
  }
  return issues;
}

/** The previous tokens must survive a fix unchanged and in the same order of first appearance. */
export function checkTokenOrder(prompt: string, previousPrompt: string): string[] {
  const before = tokenSequence(previousPrompt);
  const after = tokenSequence(prompt);
  if (before.join(",") === after.join(",")) return [];
  const show = (seq: number[]) => (seq.length === 0 ? "(none)" : seq.map(imageToken).join(" "));
  return [
    `the tokens must stay as they were, in the same order of first appearance: expected ${show(before)}, got ${show(after)}`,
  ];
}

/** The reference rules every production prompt repeats (identical text in all three damis). */
export const IMAGE_TOKEN_RULES = `## Reference tokens
The video model receives the block's prompt plus a numbered list of reference images, one per asset in assetRefs. A token \`<<<image_N>>>\` in the prompt binds the words next to it to reference image N, where N is the 1-based position of that asset in assetRefs.
- Write the token right after the asset's name where the prompt names it: "Ines <<<image_1>>> turns the map over". The name stays readable; the token never replaces it. Put the token at the first mention of the asset and again at its first mention in each later shot where it matters, so every shot binds the same look.
- assetRefs lists the referenced assets as kind:Name in the order of their numbers. Every listed asset is called by at least one token and every token has an entry in assetRefs: numbers run 1 to N with no gaps, and no asset is listed twice.
- Only assets in the asset list may be referenced. A voice is never an image reference: write the speaker's name and the line, without a token.
- An asset that is named in the block but is not referenced (no sheet available, over the limit of ${MAX_REFERENCE_IMAGES} references) stays a plain name with a few look words from its description.
- Never write \`[kind:Name]\` tags in the result, never invent other token forms, and never reuse a token number from text of another block.`;

/** Renders the available assets for the user message, in the order given. */
export function renderBlockAssets(assets: readonly BlockAsset[]): string {
  if (assets.length === 0) {
    return "## Assets available as references\n(none: reference nothing, assetRefs is empty, name everything in words)";
  }
  const rows = assets.map((a) => {
    const description = a.description ? ` - ${a.description.replace(/\s+/g, " ")}` : "";
    const voice = a.kind === "voice" ? " (voice: never an image reference)" : "";
    return `- ${a.ref}${voice}${description}`;
  });
  return ["## Assets available as references", ...rows].join("\n");
}

/** The numbered reference list of an existing prompt: token = kind:Name. */
export function renderRefList(assetRefs: readonly string[], assets: readonly BlockAsset[]): string {
  if (assetRefs.length === 0) return "(none)";
  const byRef = new Map(assets.map((a) => [a.ref, a]));
  return assetRefs
    .map((ref, i) => {
      const known = byRef.has(ref) ? "" : " (no longer in the asset list)";
      return `${imageToken(i + 1)} = ${ref}${known}`;
    })
    .join("\n");
}
