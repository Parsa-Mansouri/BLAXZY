/** Pure rules of packs: kinds, lock gates, DNA cards and which files a view attaches. */
import { designerFor, isReverseView, LOCATION_HERO_VIEWS } from "@/server/damis";
import {
  assetSheetView,
  type LookAspectRatio,
  type LookSpec,
  type SheetSpec,
  type SheetViewStatus,
} from "@/server/db/schema";
import type { AssetRow, LookRow } from "../looks";

export type PackViewRow = typeof assetSheetView.$inferSelect;

export type PackKind = "location" | "prop";

/** The pack kind of an asset (its designer), or null for characters and voices. */
export function packKindOf(kind: AssetRow["kind"]): PackKind | null {
  const designer = designerFor(kind);
  return designer === "location" || designer === "prop" ? designer : null;
}

/** A view of a pack as the screens show it (its latest version). */
export type PackView = {
  id: string;
  viewId: string;
  versionNumber: number;
  label: string;
  position: number;
  status: SheetViewStatus;
  purpose: string | null;
  fileId: string | null;
  aspectRatio: LookAspectRatio;
  /** The reviewer's checklist. */
  mustShow: string[];
  mustNotShow: string[];
  reviewFocus: string[];
  /** Parts the view proposes that the spec does not define: approved with the view. */
  newHypotheses: string[];
  editMode: "full" | "edit_previous_view";
  /** The dami's notes about this view; `DESIGN_CHANGE_REQUESTED:` ones offer the design route. */
  warnings: string[];
  /** Views it waits for (not approved yet), by label. */
  waitingFor: string[];
  /** A version answers a rejected one (a fix or a re-roll). */
  parentId: string | null;
  failure: string | null;
  isSample: boolean;
  createdAt: Date;
  decidedAt: Date | null;
};

/** Whether the pack can be locked, and what is missing (the owner's lock rules). */
export type PackLockGate = { canLock: boolean; missing: string[] };

/** The locked spec's identity card (location DNA, prop DNA and scale), for the screens. */
export type DnaCard = {
  summary: string;
  /** Location fixed anchors / prop signature details, as "name: where". */
  anchors: string[];
  identity: string[];
  constraints: string[];
  mutable: string[];
};

/** The most views one pack plans (the sheet makers' schemas cap their plans at this). */
export const MAX_VIEWS = 20;

/** The prop views that must be approved before a lock, by sheet level. */
function requiredPropViews(level: SheetSpec["sheetLevel"], views: readonly PackViewRow[]) {
  if (level === "simple") return [];
  if (level === "production") return [...views];
  return views.filter(
    (v) => v.viewId.startsWith("state_") || !/^(detail|material)_|^interaction$/.test(v.viewId),
  );
}

/**
 * The owner's lock rules. Location: the Hero (the accepted look) and the Reverse view approved.
 * Prop: simple locks with the Hero and the scale card; standard needs its orthographic, back,
 * scale and state views; production needs every planned view. No view may still be generating.
 */
export function packLockGate(
  kind: PackKind,
  spec: SheetSpec | null,
  views: readonly PackViewRow[],
): PackLockGate {
  const missing: string[] = [];
  if (!spec) return { canLock: false, missing: ["The views are still being planned."] };
  if (kind === "location") {
    const reverse = views.filter((v) => isReverseView(v.viewId));
    if (reverse.length === 0 || reverse.some((v) => v.status !== "accepted")) {
      missing.push(reverse[0]?.label ?? "Reverse");
    }
  } else {
    for (const v of requiredPropViews(spec.sheetLevel, views)) {
      if (v.status !== "accepted") missing.push(v.label);
    }
  }
  const generating = views.some((v) => v.status === "pending");
  if (generating) missing.push("Views still being made");
  return { canLock: missing.length === 0, missing };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((v) => (record(v) ? [record(v) ?? {}] : [])) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** The DNA card of an accepted location or prop design (null for characters). */
export function dnaCardOf(kind: PackKind, spec: LookSpec | null): DnaCard | null {
  const output = spec?.output;
  const dna = record(output?.dna);
  if (!output || !dna) return null;
  if (kind === "location") {
    const vi = record(dna.visual_identity) ?? {};
    return {
      summary: str(output.location_summary) || (spec?.summary ?? ""),
      anchors: list(dna.fixed_anchors).map((a) => `${str(a.name)}: ${str(a.where)}`),
      identity: [
        str(dna.geometry),
        str(vi.era),
        str(vi.architectural_style),
        strings(vi.materials).join(", "),
        strings(vi.base_palette).join(", "),
        str(vi.wear_level),
        str(vi.scale),
      ].filter(Boolean),
      constraints: strings(dna.continuity_constraints),
      mutable: strings(dna.mutable_elements),
    };
  }
  const geometry = record(dna.geometry) ?? {};
  return {
    summary: [str(dna.object_type), str(dna.front_definition)].filter(Boolean).join(" · "),
    anchors: list(dna.signature_details).map(
      (d) =>
        `${str(d.description)}: ${str(d.face)}${str(d.position) ? `, ${str(d.position)}` : ""}`,
    ),
    identity: [
      str(geometry.silhouette),
      str(geometry.proportions),
      list(dna.materials)
        .map((m) => [str(m.material), str(m.finish), str(m.color)].filter(Boolean).join(" "))
        .join("; "),
      strings(dna.palette).join(", "),
    ].filter(Boolean),
    constraints: [...strings(dna.must_keep), ...strings(dna.must_not).map((m) => `Never: ${m}`)],
    mutable: strings(dna.mutable),
  };
}

/** The Hero's view id of a location pack (interior `hero_wide`, exterior `establishing_wide`). */
export function heroViewIdOf(kind: PackKind, look: Pick<LookRow, "spec">): string {
  if (kind === "prop") return "hero_34";
  const layout = record(look.spec?.output.layout);
  return layout?.space_kind === "exterior" ? "establishing_wide" : "hero_wide";
}

/** The most images one view attaches (the owner tunes prompts for four). */
const MAX_VIEW_FILES = 4;

/**
 * The files a view attaches, in its reference order: the Hero, approved views, the previous
 * version (edit mode) and the user's own photos. Unknown or missing sources are skipped.
 */
export function viewReferenceFiles(
  view: Pick<PackViewRow, "referenceOrder" | "parentId">,
  ctx: { heroFileId: string; heroViewId: string; userFileIds: readonly string[] },
  accepted: ReadonlyMap<string, string>,
  previousFileId: string | null,
): string[] {
  const files: string[] = [];
  for (const ref of [...view.referenceOrder].sort((a, b) => a.index - b.index)) {
    let file: string | null | undefined = null;
    const s = ref.source;
    if (s === "approved_hero" || s === ctx.heroViewId || LOCATION_HERO_VIEWS.includes(s)) {
      file = ctx.heroFileId;
    } else if (s.startsWith("previous:")) {
      file = previousFileId;
    } else if (s.startsWith("user_reference:")) {
      file = ctx.userFileIds[Number(s.slice("user_reference:".length)) - 1];
    } else {
      file = accepted.get(s.startsWith("approved_view:") ? s.slice("approved_view:".length) : s);
    }
    if (file && !files.includes(file)) files.push(file);
    if (files.length === MAX_VIEW_FILES) break;
  }
  if (!files.includes(ctx.heroFileId) && files.length < MAX_VIEW_FILES) {
    files.unshift(ctx.heroFileId);
  }
  return files;
}
