/**
 * The catalogue of issues the review UI offers when a director rejects an asset's reference
 * sheet. Each code maps to a concrete instruction for the sheet-fixer dami. Adding, removing or
 * rewording an entry changes the fixer's prompt: bump its version.
 */
import type { AssetKind } from "@/server/db/schema";
import { IMAGE_ASSET_KINDS, type ImageIssueDefinition } from "../shared/reference";

export const SHEET_ISSUE_CODES = [
  "face_incomplete",
  "anatomy_wrong",
  "wrong_age",
  "wrong_clothing",
  "wrong_era",
  "text_or_labels",
  "style_mismatch",
  "background_not_clean",
  "inconsistent_views",
  "proportions_off",
  "missing_view",
  "wrong_framing",
  "differs_from_look",
  "layout_cluttered",
] as const;

export type SheetIssueCode = (typeof SHEET_ISSUE_CODES)[number];
export type SheetIssueDefinition = ImageIssueDefinition<SheetIssueCode>;

export const SHEET_ISSUES: Readonly<Record<SheetIssueCode, SheetIssueDefinition>> = {
  face_incomplete: {
    code: "face_incomplete",
    label: "Face not fully generated",
    hint: "A face in one of the views is blurred, cropped or distorted.",
    instruction:
      "Demand a fully visible, sharp face in every view where a face shows, and in the close-ups: both eyes, nose and mouth drawn clearly, nothing across the face. Describe the face as the reference image shows it, so every view repeats it.",
  },
  anatomy_wrong: {
    code: "anatomy_wrong",
    label: "Extra or missing limbs or fingers",
    hint: "A view has too many or too few limbs, hands or fingers.",
    instruction:
      "State the anatomy for every figure: two arms, two legs, two hands with five fingers each, relaxed and fully visible. Keep poses simple and still so limbs cannot tangle; for a creature state the exact number of legs, wings or heads in every view.",
  },
  wrong_age: {
    code: "wrong_age",
    label: "Wrong age",
    hint: "In some views they look younger or older than the accepted image.",
    instruction:
      "State the age range once and tie it to visible cues (skin, lines, hair, posture) that must appear in every view and every close-up. Say that all views show the same person at the same age as the reference image.",
  },
  wrong_clothing: {
    code: "wrong_clothing",
    label: "Wrong clothing",
    hint: "The outfit differs between views or from the accepted image.",
    instruction:
      "Describe the outfit garment by garment as the reference image shows it and state that every view wears exactly that, with the same colours, fabrics, fastenings and trim, including the back view.",
  },
  wrong_era: {
    code: "wrong_era",
    label: "Wrong era",
    hint: "Some things belong to another time or place.",
    instruction:
      "Name the era and place and state that every garment, object and architectural element in every view belongs to it. Replace anachronisms and add a short exclusion for them.",
  },
  text_or_labels: {
    code: "text_or_labels",
    label: "Text, labels or watermark",
    hint: "Letters, captions, view names, arrows or watermarks appear on the sheet.",
    instruction:
      "Remove any wording that invites labels (names, captions, 'sheet with notes', 'annotated', measurements written out) and state that the sheet carries no text, letters, numbers, arrows, labels, logo or watermark. Scale cues are drawn objects, never numbers.",
  },
  style_mismatch: {
    code: "style_mismatch",
    label: "Style doesn't match",
    hint: "The sheet's look differs from the accepted image or the project.",
    instruction:
      "Open the prompt with the project's visual style in concrete rendering terms and state that the sheet matches the attached reference image's rendering exactly (technique, palette, texture, light). Remove words that pull toward another style.",
  },
  background_not_clean: {
    code: "background_not_clean",
    label: "Background is not clean",
    hint: "There are scenes, gradients, frames or clutter behind the views.",
    instruction:
      "Set one plain seamless neutral light-grey background across the whole sheet, no panel borders, no props, no floor lines, no scenery, even light. Locations keep their architecture but lose people, vehicles and stray objects.",
  },
  inconsistent_views: {
    code: "inconsistent_views",
    label: "Views don't match each other",
    hint: "The face, outfit or details change from view to view.",
    instruction:
      "State repeatedly and concretely that every view shows exactly the same subject as the attached reference image: the same face, hair, outfit, colours, markings and proportions. List the identifying details once, in detail, so they repeat in every view.",
  },
  proportions_off: {
    code: "proportions_off",
    label: "Proportions are off",
    hint: "Head, body, limbs or objects change size between views.",
    instruction:
      "Ask for the views drawn to one shared scale, aligned on a common ground line and a common head or top line, with the same body proportions as the reference image (state them: height in heads, shoulder width, leg length). For objects, one shared scale for all views.",
  },
  missing_view: {
    code: "missing_view",
    label: "A view is missing",
    hint: "The back, a side or a close-up is not on the sheet.",
    instruction:
      "Name every required view explicitly and in order, with its angle, and say how many panels the sheet has. Make room by reducing the size of each view, not by dropping one. Use the layout the original sheet used, with the missing view added.",
  },
  wrong_framing: {
    code: "wrong_framing",
    label: "Wrong framing",
    hint: "Views are cropped, too small, overlapping or at the wrong angles.",
    instruction:
      "State the framing per view: each figure whole and uncropped with margin, no overlaps, angles exactly as required (front, three-quarter, side, back), close-ups filling their panel with the whole face visible.",
  },
  differs_from_look: {
    code: "differs_from_look",
    label: "Doesn't match the accepted image",
    hint: "The sheet drifted from the picture I approved.",
    instruction:
      "Describe the accepted reference image in concrete detail at the start of the prompt (every identifying feature as it appears there) and state that the sheet reproduces that subject faithfully. Do not add features the reference image does not show.",
  },
  layout_cluttered: {
    code: "layout_cluttered",
    label: "Layout is cluttered",
    hint: "The sheet is crowded, uneven or hard to read.",
    instruction:
      "Simplify the layout: one clear row of the main views, a second row for close-ups and details, equal spacing, generous margins, same scale across a row. Remove optional extras until nothing touches or overlaps.",
  },
};

/** The catalogue as an ordered list (for the UI). */
export const SHEET_ISSUE_LIST: readonly SheetIssueDefinition[] = SHEET_ISSUE_CODES.map(
  (code) => SHEET_ISSUES[code],
);

/** Living subjects with a face and a body. */
const BEINGS: readonly AssetKind[] = ["character", "creature"];
/** Everything with a sheet except a location, which is the background itself. */
const NOT_PLACES: readonly AssetKind[] = IMAGE_ASSET_KINDS.filter((k) => k !== "location");

/**
 * Which kinds of asset each sheet issue applies to: the review UI offers only those and the
 * service refuses the rest. Same reasoning as the look issues. Not part of the fixer's prompt.
 */
export const SHEET_ISSUE_KINDS: Readonly<Record<SheetIssueCode, readonly AssetKind[]>> = {
  face_incomplete: BEINGS,
  anatomy_wrong: BEINGS,
  wrong_age: BEINGS,
  wrong_clothing: ["character", "costume"],
  wrong_era: IMAGE_ASSET_KINDS,
  text_or_labels: IMAGE_ASSET_KINDS,
  style_mismatch: IMAGE_ASSET_KINDS,
  background_not_clean: NOT_PLACES,
  inconsistent_views: IMAGE_ASSET_KINDS,
  proportions_off: IMAGE_ASSET_KINDS,
  missing_view: IMAGE_ASSET_KINDS,
  wrong_framing: IMAGE_ASSET_KINDS,
  differs_from_look: IMAGE_ASSET_KINDS,
  layout_cluttered: IMAGE_ASSET_KINDS,
};

/** True when the sheet issue applies to this kind of asset. */
export function sheetIssueFits(code: SheetIssueCode, kind: AssetKind): boolean {
  return SHEET_ISSUE_KINDS[code].includes(kind);
}

/** The sheet issues offered for one kind of asset, in catalogue order (none for a voice). */
export function sheetIssuesFor(kind: AssetKind): readonly SheetIssueDefinition[] {
  return SHEET_ISSUE_LIST.filter((issue) => sheetIssueFits(issue.code, kind));
}
