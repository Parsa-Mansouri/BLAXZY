/**
 * Pure helpers of a look's review: the designer's catalog as the request-changes panel shows it,
 * turning the panel's draft into the selections `submitLookReview` takes, the reference photos a
 * change would contradict, the designer's warnings and the spec card's groups.
 */
import type { LookSpecView, LookView } from "@/server/assets";
import type { FixSelection } from "@/server/damis";
import type { ClientReviewOption } from "@/lib/review-option";
import type { DesignerInfo } from "./designer-view";

export type LookReference = LookView["references"][number];
export type SpecField = LookSpecView["fields"][number];
export type LookAspectRatio = NonNullable<LookView["aspectRatio"]>;

export type LookSide = "technical" | "preference";

/** The options of one side, in catalog order. */
export function optionsFor(
  options: readonly ClientReviewOption[],
  side: LookSide,
): ClientReviewOption[] {
  return options.filter((o) => o.kind === side);
}

/** The re-roll option ("Try again"), sent alone with the same prompt; null when there is none. */
export function regenerateOption(
  options: readonly ClientReviewOption[],
): ClientReviewOption | null {
  return options.find((o) => o.kind === "regenerate") ?? null;
}

/** Labels plainer than the catalog's, where it writes "(write it)". */
export function optionLabel(option: Pick<ClientReviewOption, "label">): string {
  return option.label.replace(/\s*\(write it\)\s*$/i, "");
}

/** The ready answers of an option's follow-up (one is picked), or none. */
export function followupChips(option: ClientReviewOption): { label: string; value: string }[] {
  const followup = option.followup;
  if (!followup || followup.type === "text" || followup.type === "steps") return [];
  return followup.options.map(({ label, value }) => ({ label, value }));
}

/** True when the option takes the user's own words. */
export function takesText(option: ClientReviewOption): boolean {
  return option.needsText || option.followup?.allowCustom === true;
}

/**
 * True when the option cannot be sent without a chip or the user's words: its instruction takes a
 * `{value}`, or it needs text.
 */
export function needsAnswer(option: ClientReviewOption): boolean {
  return option.needsText || option.takesValue;
}

/** True when anything opens under the picked option: chips, a text field or the frame picker. */
export function hasStrip(option: ClientReviewOption, frames: readonly unknown[]): boolean {
  return followupChips(option).length > 0 || takesText(option) || frames.length > 0;
}

/** Everything the request-changes panel collects. */
export interface LookReviewDraft {
  picked: string[];
  /** The chosen chip per option code. */
  values: Record<string, string>;
  /** The user's words per option code. */
  texts: Record<string, string>;
  /** The board frame per option code (characters). */
  views: Record<string, string>;
  note: string;
}

export const EMPTY_LOOK_DRAFT: LookReviewDraft = {
  picked: [],
  values: {},
  texts: {},
  views: {},
  note: "",
};

export type BuiltLookSelections =
  { ok: true; selections: FixSelection[] } | { ok: false; error: string; code: string };

/**
 * The selections for `submitLookReview`, or the first problem in plain words. A chip goes as
 * `value`; the user's words as `customText` (they fill `{value}` when no chip is picked).
 */
export function buildLookSelections(
  draft: LookReviewDraft,
  options: readonly ClientReviewOption[],
  maxText: number,
): BuiltLookSelections {
  const selections: FixSelection[] = [];
  for (const code of draft.picked) {
    const option = options.find((o) => o.code === code);
    if (!option || option.kind === "regenerate") continue;
    const value = draft.values[code]?.trim() || undefined;
    const text = takesText(option) ? draft.texts[code]?.trim() || undefined : undefined;
    const label = optionLabel(option);
    if (needsAnswer(option)) {
      const chips = followupChips(option).length > 0;
      if (option.needsText && !text && !(chips && value)) {
        return { ok: false, code, error: `Say what you want for “${label}”.` };
      }
      if (!value && !text) {
        return { ok: false, code, error: `Pick an answer or say what you want for “${label}”.` };
      }
    }
    if (text && text.length > maxText) {
      return { ok: false, code, error: `Keep the words for “${label}” shorter.` };
    }
    const view = draft.views[code];
    selections.push({
      code,
      ...(value ? { value } : {}),
      ...(text ? { customText: text } : {}),
      ...(view ? { viewId: view } : {}),
    });
  }
  return { ok: true, selections };
}

/** The reference roles a change contradicts, for this designer. */
export function conflictingRoles(
  option: ClientReviewOption,
  designer: Pick<DesignerInfo, "key" | "conflicts">,
): readonly string[] {
  if (designer.key === "character") {
    return option.conflictsWithReference ? [option.conflictsWithReference] : [];
  }
  return designer.conflicts[option.code] ?? [];
}

export interface ReferenceConflict {
  /** The photos the change goes against. */
  references: LookReference[];
  /** The picked changes that go against them (labels). */
  changes: string[];
}

/**
 * The reference photos the picked preference changes contradict (the owner: ask before running a
 * change that goes against a photo). Null when nothing is contradicted.
 */
export function findReferenceConflict(
  picked: readonly string[],
  options: readonly ClientReviewOption[],
  references: readonly LookReference[],
  designer: Pick<DesignerInfo, "key" | "conflicts">,
): ReferenceConflict | null {
  if (references.length === 0) return null;
  const roles = new Set<string>();
  const changes: string[] = [];
  for (const code of picked) {
    const option = options.find((o) => o.code === code);
    if (!option || option.kind !== "preference") continue;
    const hit = conflictingRoles(option, designer).filter((role) =>
      references.some((r) => r.role === role),
    );
    if (hit.length === 0) continue;
    hit.forEach((role) => roles.add(role));
    changes.push(optionLabel(option));
  }
  if (roles.size === 0) return null;
  return { references: references.filter((r) => roles.has(r.role)), changes };
}

/** Roles whose photos a prop keeps exactly: the ones a `REFERENCE_CONFLICT:` warning is about. */
const EXACT_PROP_ROLES = ["identity", "material", "detail"];

/** The photos a prop designer's `REFERENCE_CONFLICT:` warning is most likely about. */
export function exactReferences(references: readonly LookReference[]): LookReference[] {
  const exact = references.filter((r) => EXACT_PROP_ROLES.includes(r.role));
  return exact.length > 0 ? exact : [...references];
}

/** The look's photos without `drop`, or with `replacement` taking the first one's place. */
export function nextReferences(
  references: readonly LookReference[],
  drop: readonly LookReference[],
  replacement?: { fileId: string },
): LookReference[] {
  const dropped = new Set(drop.map((r) => r.fileId));
  const first = drop[0];
  const out: LookReference[] = [];
  for (const ref of references) {
    if (!dropped.has(ref.fileId)) {
      out.push(ref);
    } else if (replacement && first && ref.fileId === first.fileId) {
      out.push({ fileId: replacement.fileId, role: ref.role });
    }
  }
  return out;
}

const REFERENCE_PREFIX = "REFERENCE_CONFLICT:";
const LOCATION_PREFIX = "LOCATION_CONFLICT:";

export interface DesignerWarnings {
  /** A change the designer did not make because a photo says otherwise. */
  referenceConflict: string | null;
  /** A change the designer did not make because the location's Hero says otherwise. */
  locationConflict: string | null;
  others: string[];
}

/** The designer's warnings, with the two conflicts the screen answers taken out. */
export function splitWarnings(warnings: readonly string[]): DesignerWarnings {
  const out: DesignerWarnings = { referenceConflict: null, locationConflict: null, others: [] };
  for (const raw of warnings) {
    const warning = raw.trim();
    if (!warning) continue;
    if (warning.startsWith(REFERENCE_PREFIX)) {
      out.referenceConflict ??= warning.slice(REFERENCE_PREFIX.length).trim();
    } else if (warning.startsWith(LOCATION_PREFIX)) {
      out.locationConflict ??= warning.slice(LOCATION_PREFIX.length).trim();
    } else {
      out.others.push(warning);
    }
  }
  return out;
}

/** The location designer's spec groups, in the owner's order. */
const SPEC_GROUP_ORDER = ["Identity", "Spatial", "Visual", "Environment", "Continuity"];

export interface SpecGroup {
  /** Null for ungrouped fields (props). */
  label: string | null;
  fields: SpecField[];
}

/** The spec card's fields in groups: the owner's order first, any other group after. */
export function groupSpecFields(fields: readonly SpecField[]): SpecGroup[] {
  const groups = new Map<string | null, SpecField[]>();
  for (const field of fields) {
    const key = field.group?.trim() || null;
    groups.set(key, [...(groups.get(key) ?? []), field]);
  }
  const rank = (label: string | null) => {
    if (label === null) return -1;
    const i = SPEC_GROUP_ORDER.indexOf(label);
    return i === -1 ? SPEC_GROUP_ORDER.length : i;
  };
  return [...groups.entries()]
    .map(([label, list]) => ({ label, fields: list }))
    .sort((a, b) => rank(a.label) - rank(b.label));
}

/** `back_and_underside` → "Back and underside"; "Form and size" stays as it is. */
export function fieldName(field: string): string {
  const words = field.replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
