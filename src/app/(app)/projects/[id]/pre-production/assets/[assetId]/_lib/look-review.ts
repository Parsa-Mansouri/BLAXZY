/**
 * Pure helpers of a look's review: the reference photos a designer's warning is about, the
 * designer's warnings and the spec card's groups.
 */
import type { LookSpecView, LookView } from "@/server/assets";

export type LookReference = LookView["references"][number];
export type SpecField = LookSpecView["fields"][number];
export type LookAspectRatio = NonNullable<LookView["aspectRatio"]>;

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
