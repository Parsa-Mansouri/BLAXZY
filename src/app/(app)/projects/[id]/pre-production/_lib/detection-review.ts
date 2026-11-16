/**
 * Pure helpers of the "Something wrong with this list?" review on the category screens: which
 * warnings belong to a category and what one-tap fix each offers. The review itself is one free
 * text box; a warning's fix opens it with a sentence already written.
 */
import type { DetectionWarning } from "@/server/assets";
import type { AssetKindKey } from "../../_lib/asset-kinds";

/** What the helpers need of an asset. */
export interface ReviewAsset {
  id: string;
  kind: AssetKindKey;
  name: string;
}

/** `character`, `Mara` → `character:Mara`, as the detector names assets. */
export function assetRef(asset: Pick<ReviewAsset, "kind" | "name">): string {
  return `${asset.kind}:${asset.name}`;
}

/** The words a card's "Something Is Wrong With This One" starts the note with. */
export function aboutAsset(asset: Pick<ReviewAsset, "name">): string {
  return `About ${asset.name}: `;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** Where `needle` appears in `haystack` as a whole word, as [start, end) spans. */
function wholeWordSpans(haystack: string, needle: string): [number, number][] {
  const spans: [number, number][] = [];
  if (!needle) return spans;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    const end = at + needle.length;
    if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[end])) spans.push([at, end]);
    at = haystack.indexOf(needle, at + 1);
  }
  return spans;
}

/**
 * The assets the text names as whole words (case-insensitive), in text order. A name inside a
 * longer named one ("Mara" in "Mara (2)") only counts where it also appears on its own.
 */
export function namedAssets<T extends ReviewAsset>(text: string, assets: readonly T[]): T[] {
  const haystack = text.toLowerCase();
  const matches = assets.map((asset) => ({
    asset,
    spans: wholeWordSpans(haystack, asset.name.toLowerCase()),
  }));
  const found: { asset: T; at: number }[] = [];
  for (const m of matches) {
    const own = m.spans.filter(
      ([start, end]) =>
        !matches.some(
          (o) =>
            o !== m &&
            o.asset.name.length > m.asset.name.length &&
            o.spans.some(([os, oe]) => os <= start && end <= oe),
        ),
    );
    const first = own[0];
    if (first) found.push({ asset: m.asset, at: first[0] });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.asset);
}

/** The kind a warning tag is about when it names no asset of the screen. */
const TAG_KINDS: Record<string, AssetKindKey> = {
  NO_LOCATION: "location",
  AMBIGUOUS: "location",
  REAL_PERSON: "character",
};

/** Tags that only make sense for the assets they name. */
const NAMED_ONLY = new Set(["MERGE_CHECK", "APPROVED_CONFLICT"]);

/**
 * The one-tap fix of a warning on a category screen:
 * - `review`: open the review box with a sentence already written (the user finishes it);
 * - `add`: add the missing thing by hand, prefilled;
 * - `remove`: remove the named asset.
 */
export type WarningFix =
  | { type: "review"; label: string; note: string }
  | { type: "add"; label: string; name: string; description: string }
  | { type: "remove"; label: string; assetId: string; name: string };

export interface CategoryWarning {
  key: string;
  tag: string;
  text: string;
  fix: WarningFix | null;
}

/** A NOT_IN_SCRIPT text as a name when it is short, else as a description. */
function addPrefill(text: string): { name: string; description: string } {
  const clean = text.trim().replace(/^["“]|["”]$/g, "");
  return clean.length <= 60 && !/[.!?]$/.test(clean)
    ? { name: clean, description: "" }
    : { name: "", description: clean };
}

function fixFor(warning: DetectionWarning, named: readonly ReviewAsset[]): WarningFix | null {
  switch (warning.tag) {
    case "MERGE_CHECK": {
      const [first, second] = named;
      return first && second
        ? {
            type: "review",
            label: "They're the Same",
            note: `${first.name} and ${second.name} are the same ${first.kind}. Keep one of them.`,
          }
        : null;
    }
    case "NOT_IN_SCRIPT":
      return { type: "add", label: "Add It Yourself", ...addPrefill(warning.text) };
    case "NO_LOCATION":
      return { type: "review", label: "Name the Place", note: "The place of the scene is: " };
    case "AMBIGUOUS":
      return { type: "review", label: "Explain It", note: "" };
    case "APPROVED_CONFLICT": {
      const target = named[0];
      return target
        ? { type: "remove", label: "Remove It", assetId: target.id, name: target.name }
        : null;
    }
    default:
      return null;
  }
}

/**
 * The warnings a category screen shows, each with its fix. A warning that names assets of the
 * screen belongs to it; one that names none belongs to the kind its tag is about, and the rest
 * (missing things, script gaps) show on every screen. MERGE_CHECK and APPROVED_CONFLICT show
 * only where their assets are.
 */
export function categoryWarnings(
  warnings: readonly DetectionWarning[],
  kind: AssetKindKey,
  assets: readonly ReviewAsset[],
): CategoryWarning[] {
  const out: CategoryWarning[] = [];
  warnings.forEach((warning, i) => {
    const named = namedAssets(warning.text, assets);
    if (named.length === 0) {
      if (NAMED_ONLY.has(warning.tag)) return;
      const tagKind = TAG_KINDS[warning.tag];
      if (tagKind && tagKind !== kind) return;
    }
    out.push({
      key: `${i}:${warning.tag}`,
      tag: warning.tag,
      text: warning.text,
      fix: fixFor(warning, named),
    });
  });
  return out;
}
