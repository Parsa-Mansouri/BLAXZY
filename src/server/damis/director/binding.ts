/**
 * Pure translation between the Director's asset ids and BLAXZY's assets. The Director writes
 * `@char_1`, `@loc_1`, `@prop_1` (output_21 ids); production prompts use the real name followed by
 * a reference token, `Nora <<<image_1>>>`, with the references listed as `kind:Name` in token
 * order (see `shared/block.ts`). Nothing here touches the database or Claude.
 */
import type { AssetKind } from "@/server/db/schema";
import { formatAssetRef } from "../shared/asset-ref";
import { imageToken, MAX_REFERENCE_IMAGES } from "../shared/block";

/** `@char_1`, `@loc_2`, `@prop_3`, and the provisional `@new_char_1` (voices never bind). */
const ID_TOKEN = /@((?:new_)?(?:char|loc|prop)_\d+)(?![A-Za-z0-9_])/g;

/** What a Director id stands for in BLAXZY. `reference: false` = no sheet: written as a plain name. */
export type AssetBinding = { kind: AssetKind; name: string; reference?: boolean };

export type BoundPrompt = {
  /** The prompt with `@id` replaced by `Name <<<image_N>>>`. */
  prompt: string;
  /** `kind:Name` per token, in token order (the position is the N of `<<<image_N>>>`). */
  assetRefs: string[];
  /** Ids found in the prompt that the map does not know; their `@id` is left as written. */
  unmapped: string[];
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces each `@id` with the asset's name and its token. Tokens are numbered by first
 * appearance; the same asset keeps its number on every mention. When the name already follows the
 * id (`@char_1 NORA`), the two are merged (`Nora <<<image_1>>>`). At most
 * `MAX_REFERENCE_IMAGES` assets get a token; later ones, and assets marked `reference: false`,
 * become plain names. Voices are never bound.
 */
export function bindAssetTokens(
  promptText: string,
  assets: ReadonlyMap<string, AssetBinding>,
): BoundPrompt {
  const assetRefs: string[] = [];
  const numbers = new Map<string, number>();
  const unmapped: string[] = [];

  const numberFor = (ref: string): number | null => {
    const known = numbers.get(ref);
    if (known !== undefined) return known;
    if (assetRefs.length >= MAX_REFERENCE_IMAGES) return null;
    assetRefs.push(ref);
    numbers.set(ref, assetRefs.length);
    return assetRefs.length;
  };

  let prompt = "";
  let consumed = 0;
  for (const match of promptText.matchAll(ID_TOKEN)) {
    const start = match.index;
    const id = match[1] ?? "";
    const asset = assets.get(id);
    prompt += promptText.slice(consumed, start);
    let end = start + match[0].length;
    consumed = start;
    if (!asset || asset.kind === "voice") {
      if (!asset && !unmapped.includes(id)) unmapped.push(id);
      prompt += match[0];
      consumed = end;
      continue;
    }
    const n = asset.reference === false ? null : numberFor(formatAssetRef(asset.kind, asset.name));
    prompt += n === null ? asset.name : `${asset.name} ${imageToken(n)}`;
    // Merge "@char_1 NORA" into one mention: skip the name that follows the id.
    const echoed = new RegExp(`^\\s+${escapeRegExp(asset.name)}(?![\\p{L}\\p{N}_])`, "iu").exec(
      promptText.slice(end),
    );
    if (echoed) end += echoed[0].length;
    consumed = end;
  }
  prompt += promptText.slice(consumed);
  return { prompt, assetRefs, unmapped };
}

/** The output_21-style id prefix of a BLAXZY asset kind, or null for kinds output_21 has no id for. */
export function idPrefixForKind(kind: AssetKind): "char" | "loc" | "prop" | null {
  switch (kind) {
    case "character":
    case "creature":
      return "char";
    case "location":
      return "loc";
    case "prop":
      return "prop";
    default:
      return null;
  }
}

export type AssetIdEntry = { id: string; kind: AssetKind; name: string; ref: string };

/**
 * Stable output_21-style ids for BLAXZY assets: `char_1`, `loc_1`, `prop_1`... numbered per
 * prefix by first appearance in `assets` (characters and creatures share `char_`). Voices,
 * costumes and `other` assets get no id. A repeated `kind:Name` keeps its first id.
 */
export function buildAssetIds(
  assets: readonly { kind: AssetKind; name: string }[],
): AssetIdEntry[] {
  const counts = { char: 0, loc: 0, prop: 0 };
  const seen = new Map<string, AssetIdEntry>();
  const entries: AssetIdEntry[] = [];
  for (const asset of assets) {
    const prefix = idPrefixForKind(asset.kind);
    if (!prefix) continue;
    const ref = formatAssetRef(asset.kind, asset.name);
    if (seen.has(ref)) continue;
    counts[prefix] += 1;
    const entry = { id: `${prefix}_${counts[prefix]}`, kind: asset.kind, name: asset.name, ref };
    seen.set(ref, entry);
    entries.push(entry);
  }
  return entries;
}

/** The id to binding map `bindAssetTokens` takes, from `buildAssetIds`. */
export function bindingMap(
  entries: readonly AssetIdEntry[],
  options: { withoutReference?: ReadonlySet<string> } = {},
): Map<string, AssetBinding> {
  return new Map(
    entries.map((e) => [
      e.id,
      {
        kind: e.kind,
        name: e.name,
        reference: options.withoutReference?.has(e.ref) ? false : true,
      },
    ]),
  );
}
