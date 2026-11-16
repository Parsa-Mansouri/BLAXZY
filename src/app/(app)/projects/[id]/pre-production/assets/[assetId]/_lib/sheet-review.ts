/**
 * Pure helpers of a sheet's review: the sheet maker's refused design changes, and the words of a
 * location pack or prop sheet (what a view waits for, what the lock still needs).
 */
import type { PackView, SheetSpecView, SheetView } from "@/server/assets";

export type DetailCell = SheetSpecView["detailCells"][number];
export type PackKind = "location" | "prop";

/**
 * The sheet makers' warning for a refused design change. Mirrors `DESIGN_CHANGE_PREFIX` of
 * `@/server/damis` (kept here so client code does not pull the dami module in; a test checks it).
 */
export const DESIGN_CHANGE_WARNING = "DESIGN_CHANGE_REQUESTED:";

/** What the review screens need of a sheet maker's catalog; built by the page from `@/server/damis`. */
export interface SheetCatalogInfo {
  /** Rejected rounds in a row after which the catalog's message shows. */
  maxAttempts: number;
  attemptMessage: string | null;
  /** What the catalog says when a change belongs to the design step; null when it says nothing. */
  designChangeMessage: string | null;
}

/** A sheet maker's warnings: the design changes it refused, and the rest. */
export function splitSheetWarnings(warnings: readonly string[]): {
  designChanges: string[];
  others: string[];
} {
  const designChanges: string[] = [];
  const others: string[] = [];
  for (const raw of warnings) {
    const warning = raw.trim();
    if (!warning) continue;
    if (warning.startsWith(DESIGN_CHANGE_WARNING)) {
      const words = warning.slice(DESIGN_CHANGE_WARNING.length).trim();
      if (words) designChanges.push(words);
    } else {
      others.push(warning);
    }
  }
  return { designChanges, others };
}

/**
 * Sheets of the current design sent back in a row before the newest one (for the catalog's
 * "we have tried a few times" message). `sheets` are newest first.
 */
export function sheetRejectedInARow(sheets: readonly SheetView[]): number {
  const [latest, ...rest] = sheets;
  if (!latest) return 0;
  let n = 0;
  for (const sheet of rest) {
    if (sheet.lookId !== latest.lookId || sheet.status !== "rejected") break;
    n += 1;
  }
  return n;
}

/* ------------------------------------------------------------------------------------------ */
/* Location packs and prop sheets                                                              */
/* ------------------------------------------------------------------------------------------ */

/** "Reverse Wide", "Reverse Wide and Door Detail", "A, B and C". */
export function namesList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Where a view stands, as the pack screen shows it. */
export type ViewState =
  "review" | "approved" | "making" | "waiting" | "writing" | "failed" | "set_aside";

export function viewState(view: Pick<PackView, "status" | "waitingFor">): ViewState {
  switch (view.status) {
    case "in_review":
      return "review";
    case "accepted":
      return "approved";
    case "pending":
      return "making";
    case "planned":
      return view.waitingFor.length > 0 ? "waiting" : "writing";
    case "failed":
      return "failed";
    default:
      return "set_aside";
  }
}

/** One line on where a view stands: "Waiting for Reverse Wide", "Being made" ... */
export function viewStateWords(view: Pick<PackView, "status" | "waitingFor">): string {
  switch (viewState(view)) {
    case "review":
      return "Ready to review";
    case "approved":
      return "Approved";
    case "making":
      return "Being made";
    case "waiting":
      return `Waiting for ${namesList(view.waitingFor)}`;
    case "writing":
      return "Up next";
    case "failed":
      return "Could not be made";
    case "set_aside":
      return "Set aside";
  }
}

/** True while the pack's views are being made by themselves (the page polls quickly). */
export function packWorking(views: readonly Pick<PackView, "status" | "waitingFor">[]): boolean {
  return views.some((v) => {
    const state = viewState(v);
    return state === "making" || state === "writing";
  });
}

/** The view to open first: the first one to review, else none (the Hero shows). */
export function firstToReview(views: readonly PackView[]): PackView | null {
  return views.find((v) => v.status === "in_review") ?? null;
}

/**
 * What the lock still needs, in words: the views to approve in one sentence ("Approve Reverse
 * Wide first."), and the server's other reasons as they are.
 */
export function lockMissingWords(
  missing: readonly string[],
  views: readonly Pick<PackView, "label">[],
): string[] {
  const labels: string[] = [];
  const others: string[] = [];
  for (const raw of missing) {
    const item = raw.trim();
    if (!item) continue;
    if (views.some((v) => v.label === item)) labels.push(item);
    else if (/still being made/i.test(item)) others.push("Wait for the views still being made.");
    else if (/[.!?]$/.test(item)) others.push(item);
    else labels.push(item);
  }
  return [...(labels.length > 0 ? [`Approve ${namesList(labels)} first.`] : []), ...others];
}

/** A prop view's QA checks (the owner's `review_focus` keys) as questions to tick. */
const PROP_FOCUS: Record<string, string> = {
  shape: "The shape matches the Hero.",
  scale: "The size looks right next to the hand or figure.",
  material: "Colours, materials and wear match the Hero.",
  directional: "Details sit on the correct side, and text reads the right way round.",
  functional: "Open and closed states and moving parts make sense.",
  reference_fidelity: "Every must-keep element is there.",
};

/** The reviewer's checks of a view: a prop's focus keys in words, a location's as written. */
export function reviewChecks(kind: PackKind, focus: readonly string[]): string[] {
  return focus
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => (kind === "prop" ? (PROP_FOCUS[f] ?? f.replaceAll("_", " ")) : f));
}

/** One picture of a pack's gallery: the approved Hero first, then the views. */
export interface PackPicture {
  key: string;
  label: string;
  fileId: string;
  aspectRatio: PackView["aspectRatio"] | null;
  /** The view row (null for the Hero). */
  viewRowId: string | null;
  status: "hero" | PackView["status"];
}

/**
 * The pack's pictures: the Hero (the accepted look) first, then each view that has an image,
 * in order. `only` keeps the views of those statuses (approved ones for a locked pack).
 */
export function packPictures(
  hero: { fileId: string | null; aspectRatio: PackView["aspectRatio"] | null } | null,
  views: readonly PackView[],
  only?: readonly PackView["status"][],
): PackPicture[] {
  const pictures: PackPicture[] = [];
  if (hero?.fileId) {
    pictures.push({
      key: "hero",
      label: "Hero",
      fileId: hero.fileId,
      aspectRatio: hero.aspectRatio,
      viewRowId: null,
      status: "hero",
    });
  }
  for (const view of views) {
    if (!view.fileId) continue;
    if (only && !only.includes(view.status)) continue;
    pictures.push({
      key: view.id,
      label: view.label,
      fileId: view.fileId,
      aspectRatio: view.aspectRatio,
      viewRowId: view.id,
      status: view.status,
    });
  }
  return pictures;
}

/** "Simple sheet" and what it means for the lock. */
export function sheetLevelWords(
  level: SheetSpecView["sheetLevel"],
): { title: string; line: string } | null {
  switch (level) {
    case "simple":
      return { title: "Simple sheet", line: "The Hero and the scale card are enough to lock it." };
    case "standard":
      return {
        title: "Standard sheet",
        line: "The true front, side and back, the scale view and any states are approved before it locks.",
      };
    case "production":
      return { title: "Production sheet", line: "Every planned view is approved before it locks." };
    default:
      return null;
  }
}

const DIMENSION_WORDS: Record<NonNullable<SheetSpecView["scaleCard"]>["dimensionsStatus"], string> =
  {
    confirmed: "Measurements from the script or your answers",
    inferred: "Measurements estimated by BLAXZY",
    unknown: "Measurements unknown",
  };

export const dimensionWords = (status: keyof typeof DIMENSION_WORDS) => DIMENSION_WORDS[status];
