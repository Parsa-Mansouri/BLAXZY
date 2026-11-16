/**
 * The `<<<image_N>>>` token rules shared by the Director's binding and the production binding, and
 * the code check of a prepared prompt (used by the binding tests).
 */
import { z } from "zod";
import { ASSET_KINDS } from "@/server/db/schema";
import { assetRefSchema, assetTagPattern, formatAssetRef } from "./asset-ref";

/** The most reference images the video model accepts for one block. */
export const MAX_REFERENCE_IMAGES = 9;

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
