/**
 * Pure helpers of a sheet's review: the sheet makers' catalogs as the request-changes panel shows
 * them (the character sheet's numbered detail frames, a pack view's QA checks), turning the
 * panel's draft into the selections `submitSheetReview` and `submitSheetViewReview` take, and the
 * words of a location pack or prop sheet (what a view waits for, what the lock still needs).
 */
import type { PackView, SheetSpecView, SheetView } from "@/server/assets";
import type { FixSelection, FollowupStep, ReviewOption } from "@/server/damis";
import { followupChips, optionLabel, takesText } from "./look-review";

export type DetailCell = SheetSpecView["detailCells"][number];
export type PackKind = "location" | "prop";

/**
 * The sheet makers' warning for a refused design change. Mirrors `DESIGN_CHANGE_PREFIX` of
 * `@/server/damis` (kept here so client code does not pull the dami module in; a test checks it).
 */
export const DESIGN_CHANGE_WARNING = "DESIGN_CHANGE_REQUESTED:";

/** What a sheet maker's catalog looks like on screen; built by the page from `@/server/damis`. */
export interface SheetCatalogInfo {
  /** The catalog's options visible in the Wizard, in catalog order. */
  options: ReviewOption[];
  /** The catalog's groups (character sheet: Face, Full-body views ...; props: shape, scale ...). */
  groups: { id: string; label: string }[];
  /** Rejected rounds in a row after which the catalog's message shows. */
  maxAttempts: number;
  attemptMessage: string | null;
  /** What the catalog says when a change belongs to the design step; null when it says nothing. */
  designChangeMessage: string | null;
}

/** "1 — main fabric", as the owner's catalog displays a detail frame. */
export function cellLabel(cell: Pick<DetailCell, "slot" | "subject">): string {
  return `${cell.slot} — ${cell.subject}`;
}

/** The frame-picking step of a follow-up (the character sheet's SP01 and SP02). */
function frameStep(option: ReviewOption): FollowupStep | null {
  return (
    option.followup?.steps?.find(
      (s) => s.type === "select_detail_cell" || /detail_cells/.test(s.dynamicOptionsSource ?? ""),
    ) ?? null
  );
}

/** True when the option first asks which numbered detail frame it is about. */
export function picksFrame(option: ReviewOption): boolean {
  return frameStep(option) !== null;
}

/** The step after the frame is picked (its chips and its label), or null. */
function answerStep(option: ReviewOption): FollowupStep | null {
  const steps = option.followup?.steps;
  if (!steps) return null;
  const frame = frameStep(option);
  return steps.find((s) => s !== frame) ?? null;
}

/** The labels of a two-step follow-up: "Which frame?" and "What should it show?". */
export function stepLabels(option: ReviewOption): { frame: string; answer: string } {
  return {
    frame: frameStep(option)?.label ?? "Which frame?",
    answer: answerStep(option)?.label ?? "How should it change?",
  };
}

/** The ready answers of an option (a stepped follow-up's answer step included). */
export function sheetChips(option: ReviewOption): { label: string; value: string }[] {
  const step = answerStep(option);
  if (step) return step.options.map(({ label, value }) => ({ label, value }));
  return followupChips(option);
}

/** True when anything opens under a picked option: chips, a text box or the frame picker. */
export function hasSheetStrip(option: ReviewOption): boolean {
  return picksFrame(option) || sheetChips(option).length > 0 || takesText(option);
}

/** True when the option cannot be sent without a chip or the user's words. */
export function needsSheetAnswer(option: ReviewOption): boolean {
  return option.needsText || (option.instructionTemplate?.includes("{value}") ?? false);
}

/** The re-roll ("make it again": SR01, LSR01, ASR01), sent alone; null when there is none. */
export function rerollOption(options: readonly ReviewOption[]): ReviewOption | null {
  return options.find((o) => o.kind === "regenerate") ?? null;
}

/** The design route (SX01, LSX01, ASX01): back to the designer with the user's words. */
export function designRouteOption(options: readonly ReviewOption[]): ReviewOption | null {
  return options.find((o) => o.kind === "route") ?? null;
}

/** The options of one side of the panel, in catalog order (re-rolls and routes stand apart). */
export function sheetOptionsFor(
  options: readonly ReviewOption[],
  side: "technical" | "preference",
): ReviewOption[] {
  return options.filter((o) => o.kind === side);
}

/**
 * The option to offer before sending the picked ones: a re-roll the catalog suggests first for a
 * picked reason (random glitches such as a melted face), when that re-roll is on screen.
 */
export function suggestedFirst(
  picked: readonly string[],
  options: readonly ReviewOption[],
): { option: ReviewOption; for: string[] } | null {
  let found: ReviewOption | null = null;
  const reasons: string[] = [];
  for (const code of picked) {
    const option = options.find((o) => o.code === code);
    if (!option?.suggestFirst) continue;
    const first = options.find((o) => o.code === option.suggestFirst);
    if (!first || (found && found.code !== first.code)) continue;
    found = first;
    reasons.push(optionLabel(option));
  }
  return found ? { option: found, for: reasons } : null;
}

/** Everything the sheet's request-changes panel collects. */
export interface SheetChangesDraft {
  picked: string[];
  /** The chosen chip per option code. */
  values: Record<string, string>;
  /** The user's words per option code. */
  texts: Record<string, string>;
  /** The detail frame (its number) per option code. */
  frames: Record<string, number>;
  note: string;
  /** What should change in the design (the route's words). */
  designText: string;
}

export const EMPTY_SHEET_DRAFT: SheetChangesDraft = {
  picked: [],
  values: {},
  texts: {},
  frames: {},
  note: "",
  designText: "",
};

export type BuiltSheetSelections =
  { ok: true; selections: FixSelection[] } | { ok: false; error: string; code?: string };

/**
 * The selections for a sheet or view review, or the first problem in plain words. A chip goes as
 * `value`, the user's words as `customText`, the chosen detail frame as `slot`. Re-rolls and the
 * design route are sent on their own and are skipped here.
 */
export function buildSheetSelections(
  draft: SheetChangesDraft,
  options: readonly ReviewOption[],
  cells: readonly DetailCell[],
  maxText: number,
): BuiltSheetSelections {
  const selections: FixSelection[] = [];
  for (const code of draft.picked) {
    const option = options.find((o) => o.code === code);
    if (!option || option.kind === "regenerate" || option.kind === "route") continue;
    const label = optionLabel(option);
    let slot: FixSelection["slot"];
    if (picksFrame(option)) {
      const number = draft.frames[code];
      const cell = cells.find((c) => c.slot === number);
      if (!cell) return { ok: false, code, error: `Pick the frame for “${label}”.` };
      slot = { slot: cell.slot, subject: cell.subject };
    }
    const value = draft.values[code]?.trim() || undefined;
    const text = takesText(option) ? draft.texts[code]?.trim() || undefined : undefined;
    if (needsSheetAnswer(option)) {
      const chips = sheetChips(option).length > 0;
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
    selections.push({
      code,
      ...(value ? { value } : {}),
      ...(text ? { customText: text } : {}),
      ...(slot ? { slot } : {}),
    });
  }
  return { ok: true, selections };
}

/** The design route as a selection, with the user's words (required by the server). */
export function buildDesignChange(
  route: ReviewOption | null,
  text: string,
  maxText: number,
): BuiltSheetSelections {
  if (!route) return { ok: false, error: "The design cannot be changed from here." };
  const words = text.trim();
  if (!words)
    return { ok: false, code: route.code, error: "Say what should change in the design." };
  if (words.length > maxText) {
    return { ok: false, code: route.code, error: "Keep the words about the design shorter." };
  }
  return { ok: true, selections: [{ code: route.code, customText: words }] };
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
