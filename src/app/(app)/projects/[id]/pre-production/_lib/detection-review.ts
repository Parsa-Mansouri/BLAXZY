/**
 * Pure helpers of the "Something wrong with this list?" review on the category screens: which
 * warnings belong to a category and what one-tap fix each offers, and turning the sheet's draft
 * into the selections `submitDetectionReview` takes.
 */
import type { DetectionWarning } from "@/server/assets";
import type { FixSelection } from "@/server/damis";
import type { ClientReviewOption } from "@/lib/review-option";
import type { AssetKindKey } from "../../_lib/asset-kinds";

/** What the helpers need of an asset. */
export interface ReviewAsset {
  id: string;
  kind: AssetKindKey;
  name: string;
}

export const SKIP_CODE = "ADP01";
export const RESCAN_CODE = "ADR01";
export const SAME_CODE = "ADT02";
export const SPLIT_CODE = "ADT03";
export const CATEGORY_CODE = "ADT04";
export const MISSING_CODE = "ADT01";
export const OTHER_CODE = "ADP99";

/** The question over a reason's text box. Reasons without one take no text. */
const TEXT_PROMPTS: Record<string, string> = {
  ADT01: "What is missing?",
  ADT03: "How are they different?",
  ADT05: "What is wrong about it?",
  ADT06: "Which scenes should it be in?",
  ADT07: "What should the name or role be?",
  ADP02: "What should be its own asset?",
  ADP99: "What would you like different?",
};

/** Plainer words than the catalog's for a few reasons. */
const LABELS: Record<string, string> = {
  ADP01: "Not needed as its own asset",
  ADP99: "Something else",
};

/** The reason's label as the sheet shows it. */
export function reasonLabel(option: Pick<ClientReviewOption, "code" | "label">): string {
  return LABELS[option.code] ?? option.label;
}

export type ReviewSide = "technical" | "preference";

/** The reasons of one side, in catalog order. */
export function reasonsFor(
  options: readonly ClientReviewOption[],
  side: ReviewSide,
): ClientReviewOption[] {
  return options.filter((o) => o.kind === side);
}

/** How many assets a reason is about: 0 none, 1 exactly one, 2 two or more. */
export function targetsWanted(option: ClientReviewOption): 0 | 1 | 2 {
  const n = option.targetCount ?? 0;
  return n <= 0 ? 0 : n === 1 ? 1 : 2;
}

/** The reason's chips instead of text (Wrong category: Character / Location / Prop). */
export function chipsOf(option: ClientReviewOption): { label: string; value: string }[] {
  return option.followup?.type === "chips" ? option.followup.options : [];
}

/** The question over the reason's text box, or null when it takes no text. */
export function textPrompt(option: ClientReviewOption): string | null {
  if (chipsOf(option).length > 0) return null;
  return TEXT_PROMPTS[option.code] ?? (option.needsText ? "Tell us more" : null);
}

/** True when the reason cannot be sent without the user's text. */
export function textRequired(option: ClientReviewOption): boolean {
  return option.needsText && chipsOf(option).length === 0;
}

/** Everything the review sheet collects. */
export interface ReviewDraft {
  picked: string[];
  /** Asset ids per reason code. */
  targets: Record<string, string[]>;
  texts: Record<string, string>;
  /** The chosen chip per reason code. */
  values: Record<string, string>;
  note: string;
}

export const EMPTY_DRAFT: ReviewDraft = {
  picked: [],
  targets: {},
  texts: {},
  values: {},
  note: "",
};

/** A draft with one reason already picked (from a card's menu or a warning). */
export function draftWith(
  code: string,
  init: { targets?: string[]; text?: string } = {},
): ReviewDraft {
  return {
    ...EMPTY_DRAFT,
    picked: [code],
    targets: init.targets ? { [code]: init.targets } : {},
    texts: init.text ? { [code]: init.text } : {},
  };
}

/** `character`, `Mara` → `character:Mara`, as the detector names assets. */
export function assetRef(asset: Pick<ReviewAsset, "kind" | "name">): string {
  return `${asset.kind}:${asset.name}`;
}

/** Toggles a target: one-target reasons replace the choice, the others add or remove it. */
export function toggleTarget(current: readonly string[], id: string, wanted: 0 | 1 | 2): string[] {
  if (current.includes(id)) return current.filter((t) => t !== id);
  return wanted === 1 ? [id] : [...current, id];
}

export type BuiltSelections =
  | { ok: true; selections: FixSelection[]; note?: string }
  | { ok: false; error: string; code?: string };

const MAX_NOTE = 8000;
const MAX_TEXT = 4000;

/**
 * The selections for `submitDetectionReview`, or the first problem with the draft in plain
 * words. Targets are sent as `kind:Name` refs; a chip is sent as `value`.
 */
export function buildSelections(
  draft: ReviewDraft,
  options: readonly ClientReviewOption[],
  assets: readonly ReviewAsset[],
): BuiltSelections {
  const note = draft.note.trim();
  if (note.length > MAX_NOTE) return { ok: false, error: "Keep the note under 8,000 characters." };
  if (draft.picked.length === 0) return { ok: false, error: "Pick what is wrong first." };
  const byId = new Map(assets.map((a) => [a.id, a]));
  const selections: FixSelection[] = [];
  for (const code of draft.picked) {
    const option = options.find((o) => o.code === code);
    if (!option) return { ok: false, error: "One of the chosen fixes is not available.", code };
    const selection: FixSelection = { code };
    const wanted = targetsWanted(option);
    if (wanted > 0) {
      const refs = (draft.targets[code] ?? [])
        .map((id) => byId.get(id))
        .filter((a): a is ReviewAsset => a !== undefined)
        .map(assetRef);
      if (refs.length < wanted) {
        return {
          ok: false,
          code,
          error:
            wanted === 1
              ? `“${reasonLabel(option)}”: tap the asset it is about.`
              : `“${reasonLabel(option)}”: tap two or more assets.`,
        };
      }
      selection.targetNames = wanted === 1 ? refs.slice(0, 1) : refs;
    }
    const chips = chipsOf(option);
    if (chips.length > 0) {
      const value = draft.values[code];
      if (!value || !chips.some((c) => c.value === value)) {
        return { ok: false, code, error: `“${reasonLabel(option)}”: choose where it belongs.` };
      }
      selection.value = value;
    }
    const text = (draft.texts[code] ?? "").trim();
    if (text.length > MAX_TEXT) {
      return { ok: false, code, error: "Keep each answer under 4,000 characters." };
    }
    if (textRequired(option) && !text) {
      return {
        ok: false,
        code,
        error: `“${reasonLabel(option)}”: ${textPrompt(option) ?? "say more"}`,
      };
    }
    if (text && textPrompt(option)) selection.customText = text;
    selections.push(selection);
  }
  return note ? { ok: true, selections, note } : { ok: true, selections };
}

/* ------------------------------------------------------------------------------------------ */
/* Warnings                                                                                    */
/* ------------------------------------------------------------------------------------------ */

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
 * - `same`: open the review with "These are the same one" and both assets picked;
 * - `add`: add the missing thing by hand, prefilled;
 * - `review`: open the review with a reason picked;
 * - `remove`: remove the named asset.
 */
export type WarningFix =
  | { type: "same"; label: string; targets: string[] }
  | { type: "add"; label: string; name: string; description: string }
  | { type: "review"; label: string; code: string }
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

function fixFor(
  warning: DetectionWarning,
  named: readonly ReviewAsset[],
  available: ReadonlySet<string>,
): WarningFix | null {
  switch (warning.tag) {
    case "MERGE_CHECK":
      return named.length >= 2 && available.has(SAME_CODE)
        ? { type: "same", label: "They're the Same", targets: named.slice(0, 2).map((a) => a.id) }
        : null;
    case "NOT_IN_SCRIPT":
      return { type: "add", label: "Add It Yourself", ...addPrefill(warning.text) };
    case "NO_LOCATION":
      return available.has(MISSING_CODE)
        ? { type: "review", label: "Name the Place", code: MISSING_CODE }
        : null;
    case "AMBIGUOUS":
      return available.has(OTHER_CODE)
        ? { type: "review", label: "Explain It", code: OTHER_CODE }
        : null;
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
  options: readonly ClientReviewOption[],
): CategoryWarning[] {
  const available = new Set(options.map((o) => o.code));
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
      fix: fixFor(warning, named, available),
    });
  });
  return out;
}
